import { DocumentController } from '../../controllers/document-controller.js';

export default async function handler(req, res) {
  return await DocumentController.upload(req, res);
}

