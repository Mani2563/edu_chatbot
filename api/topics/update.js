import { TopicController } from '../../controllers/topic-controller.js';

export default async function handler(req, res) {
  return await TopicController.update(req, res);
}

