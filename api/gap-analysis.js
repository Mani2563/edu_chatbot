import { GapAnalysisController } from '../controllers/gap-analysis-controller.js';

export default async function handler(req, res) {
  return GapAnalysisController.analyze(req, res);
}

