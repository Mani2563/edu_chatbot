import { RevisionPlanController } from '../../controllers/revision-plan-controller.js';

export default async function handler(req, res) {
  return await RevisionPlanController.generate(req, res);
}

