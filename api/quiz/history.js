import { QuizController } from '../../controllers/quiz-controller.js';

export default async function handler(req, res) {
  return QuizController.history(req, res);
}

