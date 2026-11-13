import { RagController } from '../../controllers/rag-controller.js';

export default async function handler(req, res) {
  return await RagController.retrieve(req, res);
}

