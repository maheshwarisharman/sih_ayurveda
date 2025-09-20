import { ethers } from "ethers";
import dotenv from "dotenv";
import fs from "fs";
const abi = JSON.parse(fs.readFileSync("onchain/abi.json", "utf8")).abi;
dotenv.config();

// --- Setup provider + signer ---
const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Contract instance
const contract = new ethers.Contract(
  process.env.CONTRACT_ADDRESS,
  abi,
  signer
);

/* ---------------------------
   Exported Helper Functions
   --------------------------- */

// 1. Create a new batch
export async function createBatch(sku) {
  const tx = await contract.createBatch(sku);
  const receipt = await tx.wait();

  return {
    batchId: receipt.logs[0]?.args?.batchId?.toString()
  };
}

// 2. Add a stage
export async function addStage(batchId, stageType, metadataHash) {
  const tx = await contract.addStage(batchId, stageType, metadataHash);
  const receipt = await tx.wait();

  return {
    txHash: receipt.hash,
    stageIndex: receipt.logs[0]?.args?.stageIndex?.toString()
  };
}

// 3. Get batch summary
export async function getBatchSummary(batchId) {

  
  const result = await contract.getBatchSummary(batchId);

  // result is a struct tuple: [sku, stageCount, stages[]]
  return {
    sku: result[0],
    stageCount: result[1].toString(),
    stages: result[2].map(stage => ({
      stageType: stage.stageType,
      timestamp: stage.timestamp.toString(),
      metadataHash: stage.metadataHash
    }))
  };
}
