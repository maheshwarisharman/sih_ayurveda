// backend/routes/batchRoute.js
const express = require('express');
const router = express.Router();
const { createBatch, addStage, getBatchSummary } = require("../onchain/herbProvenance.js");
const { supabase } = require('../config/supabase');

const crypto = require("crypto");

// Body parser middleware
router.use(express.json());

// Configure multer for file uploads
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const event_stages = {
  'CollectionEvent': 0,
  'QualityTest': 1,
  'ProcessingStep': 2
}

// CREATE a new batch
router.post('/create', async (req, res) => {
  try{
    const batchId = await createBatch(req.body.batchName);
    res.json({ batchId, message: 'Batch created successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const createBatchHash = (metadata) => {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(metadata));
  return hash.digest('hex');
}

// Add a new stage event to Supabase
/**
 * Endpoint to add a new stage event to Supabase.
 * 
 * @route POST /add-stage-event
 * @body {string} formatted_batch_id - formatted batch id (e.g. '123-ABC')
 * @body {string} stage_type - type of stage (e.g. '0 for collection, 1 for processing, 2 for production')
 * @body {object} metadata - additional data about the stage (optional)
 * @returns {object} - response object containing message and data
 * @throws {error} - if any errors occur during the process
 */
router.post('/add-stage-event', async (req, res) => {
  try {
    const { formatted_batch_id, stage_type, metadata } = req.body;

    // Validate stage type
    if(event_stages[stage_type] == undefined){
      return res.status(400).json({ error: 'Invalid stage type' });
    }

    // Validate required fields
    if (!formatted_batch_id || stage_type == undefined) {
      return res.status(400).json({ error: 'batch_id and stage_type are required' });
    }
    const batchId = formatted_batch_id;
        
    const batchHash = createBatchHash(metadata);

    const { data, error } = await supabase
      .from('stage_events')
      .insert([
        { 
          batch_id: batchId,
          event_type: event_stages[stage_type],
          event_data: metadata || {},
          event_hash: batchHash
        }
      ])
      .select();

    if (error) throw error;

    res.status(201).json({ 
      message: 'Stage event recorded successfully',
      data: data[0],
      batchHash: batchHash
    });

    const tx = await addStage(batchId, event_stages[stage_type], batchHash);
    console.log({ txHash: tx.txHash, stageIndex: tx.stageIndex });
    return;

  } catch (error) {
    console.error('Error recording stage event:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Get all stages for a batch from both Supabase and on-chain
 * @route GET /batch-stages/:formatted_batch_id
 * @param {string} formatted_batch_id - Formatted batch ID (e.g., '1-ABC123')
 * @returns {object} - Response object containing stages from both sources and verification status
 */
router.get('/batch-stages/:formatted_batch_id', async (req, res) => {
  try {
    const { formatted_batch_id } = req.params;

    // Validate batch ID
    if (!formatted_batch_id) {
      return res.status(400).json({ error: 'formatted_batch_id is required' });
    }

    const batch_id = formatted_batch_id;

    // 1. Get stages from Supabase
    const { data: supabaseStages, error: supabaseError } = await supabase
      .from('stage_events')
      .select('*')
      .eq('batch_id', batch_id)
      .order('created_at', { ascending: true });

    if (supabaseError) throw supabaseError;

    // 2. Get stages from blockchain
    let onChainStages = [];
    try {
      const batchSummary = await getBatchSummary(parseInt(batch_id));
      onChainStages = batchSummary.stages || [];
    } catch (chainError) {
      console.error('Error fetching on-chain stages:', chainError);
    }

    // 3. Process each stage and verify hashes
    const processStage = async (supabaseStage) => {
      // Verify Supabase data integrity
      const currentDataHash = createBatchHash(supabaseStage.event_data);
      const isDataValid = currentDataHash === supabaseStage.event_hash;

      // Only check on-chain if Supabase data is valid
      let onChainVerification = false;
      let safeOnChainStage = null;
      
      if (isDataValid) {
        const onChainStage = onChainStages.find(
          stage => parseInt(stage.stageType) === parseInt(supabaseStage.event_type)
        );

        // Convert any BigInt in onChainStage to string
        safeOnChainStage = onChainStage
          ? JSON.parse(JSON.stringify(onChainStage, (_, value) =>
              typeof value === 'bigint' ? value.toString() : value
            ))
          : null;

        onChainVerification = safeOnChainStage 
          ? safeOnChainStage.metadataHash === supabaseStage.event_hash
          : false;
      }

      return {
        stage_type: supabaseStage.event_type,
        metadata: supabaseStage.event_data,
        timestamp: supabaseStage.created_at,
        data_integrity: isDataValid,
        on_chain_verified: onChainVerification,
        verified: isDataValid && onChainVerification,
        on_chain_data: safeOnChainStage
      };
    };

    // Process all stages in parallel
    const verifiedStages = await Promise.all(supabaseStages.map(processStage));

    // 4. Return combined response
    res.json({
      batch_id,
      formatted_batch_id,
      stages: verifiedStages,
      summary: {
        total_stages: verifiedStages.length,
        verified_stages: verifiedStages.filter(stage => stage.verified).length,
        verification_status: verifiedStages.length > 0 && 
          verifiedStages.every(stage => stage.verified) 
            ? 'FULLY_VERIFIED' 
            : verifiedStages.some(stage => stage.verified)
              ? 'PARTIALLY_VERIFIED'
              : 'NOT_VERIFIED'
      }
    });

  } catch (error) {
    console.error('Error fetching batch stages:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to fetch batch stages' 
    });
  }
});


/**
 * @route POST /upload-report
 * @description Upload a file to Supabase Storage under 'reports' folder and store reference in 'events' table
 * @param {file} file - The file to upload
 * @param {string} batchId - The batch ID associated with the report
 * @param {string} eventType - Type of the event (e.g., 'quality_report', 'inspection')
 * @returns {object} - Response with file URL and database record
 */
router.post('/upload-report', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const fileExt = file.originalname.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
    const filePath = `reports/${fileName}`;

    // Upload file to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('events')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error('Error uploading file:', uploadError);
      return res.status(500).json({ error: 'Failed to upload file' });
    }

    // Get public URL of the uploaded file
    const { data: { publicUrl } } = supabase.storage
      .from('events')
      .getPublicUrl(filePath);

    res.status(201).json({
      message: 'File uploaded successfully',
      fileUrl: publicUrl,
    });

  } catch (error) {
    console.error('Error in file upload:', error);
    res.status(500).json({ 
      error: error.message || 'An error occurred during file upload' 
    });
  }
});

module.exports = router;