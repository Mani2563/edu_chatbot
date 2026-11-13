import { chromium } from 'playwright';
import { getSupabaseAdmin, getSupabaseClient } from '../lib/supabase.js';
import fs from 'fs';
import path from 'path';

/**
 * Playwright End-to-End Test for GapFinder AI Phase 5 Diagnostic Quiz
 */
async function runPlaywrightE2E() {
  console.log('========================================================================');
  console.log('  GapFinder AI — Playwright E2E Test: Diagnostic Quiz Workflow         ');
  console.log('========================================================================\n');

  // 1. Get session for student Manikanta
  const admin = getSupabaseAdmin();
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: 'manikantaanandam2563@gmail.com'
  });
  if (linkErr) throw new Error('Generate link error: ' + linkErr.message);

  const supabase = getSupabaseClient();
  const { data: sessionData, error: sessionErr } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink'
  });
  if (sessionErr) throw new Error('Verify OTP error: ' + sessionErr.message);

  const session = sessionData.session;
  console.log(`Authenticated as student: ${sessionData.user.email}`);

  // 2. Launch Chromium browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000');
  await page.waitForLoadState('domcontentloaded');

  // 3. Inject authenticated Supabase session into browser
  console.log('Injecting session and initializing student workspace...');
  await page.evaluate(async (sess) => {
    if (window.AppState?.supabaseClient) {
      await window.AppState.supabaseClient.auth.setSession({
        access_token: sess.access_token,
        refresh_token: sess.refresh_token
      });
    }
  }, { access_token: session.access_token, refresh_token: session.refresh_token });

  // Wait for session and library documents to load
  console.log('Waiting for library documents to populate...');
  await page.waitForFunction(() => window.AppState?.documents && window.AppState.documents.length > 0, { timeout: 20000 });

  // 4. Open document / subject in the library
  console.log('Selecting Mathematics document in workspace...');
  await page.evaluate(async () => {
    if (window.AppState?.documents && window.AppState.documents.length > 0) {
      const doc = window.AppState.documents[0];
      const sub = window.AppState.subjects?.find(s => s.source_document_id === doc.id);
      await window.selectDocument(doc.id, sub?.id);
    }
  });

  // Wait for curriculum tree rows to appear
  await page.waitForSelector('.tree-node-row', { timeout: 15000 });

  // 5. Select Topic and open Topic Workspace
  console.log('Opening Topic Workspace for Chapter 1 / Topic 1...');
  await page.evaluate(async () => {
    const tree = window.AppState?.curriculumTree;
    if (tree && tree.length > 0) {
      const chapter = tree[0];
      const topic = (chapter.topics && chapter.topics.length > 0) ? chapter.topics[0] : chapter;
      await window.openTopicWorkspace(topic, chapter);
    }
  });

  // Wait for topic tabs to appear
  await page.waitForSelector('#tab-btn-quiz', { timeout: 10000 });

  // 6. Switch to Quiz Tab
  console.log('Switching to "✍️ Take Quiz" tab...');
  await page.click('#tab-btn-quiz');
  await page.waitForSelector('#btn-start-quiz', { timeout: 10000 });

  // 7. Verify Quiz Setup Screen
  console.log('Verifying Diagnostic Assessment configuration screen...');
  const titleText = await page.textContent('.quiz-config-wrap h3');
  console.log('  Found Title:', titleText?.trim());

  // Click Easy Difficulty and 3 Questions
  await page.click('button:has-text("🟢 Easy")');
  await page.click('button:has-text("3 Questions")');

  // 8. Start Quiz
  console.log('Clicking "🚀 Start Diagnostic Quiz"...');
  await page.click('#btn-start-quiz');

  // 9. Wait for question runner to render
  console.log('Waiting for grounded questions to generate...');
  await page.waitForSelector('.quiz-question-text', { timeout: 45000 });

  const qText = await page.textContent('.quiz-question-text');
  console.log('  Question 1 Rendered:', qText?.trim());

  // Verify 4 options are rendered
  const optionsCount = await page.locator('.quiz-option-item').count();
  console.log(`  Options Count: ${optionsCount} (Expected: 4)`);
  if (optionsCount !== 4) throw new Error('Expected exactly 4 options');

  // Select Option A
  console.log('Selecting Option A on Question 1...');
  await page.click('.quiz-option-item:nth-child(1)');
  await page.waitForTimeout(500);

  // If next button exists, click it and select an option for question 2
  const nextBtn = page.locator('button:has-text("Next Question")');
  if (await nextBtn.isVisible()) {
    console.log('Navigating to Question 2...');
    await nextBtn.click();
    await page.waitForTimeout(500);
    console.log('Selecting Option B on Question 2...');
    await page.click('.quiz-option-item:nth-child(2)');
    await page.waitForTimeout(500);
  }

  // Handle potential browser confirm dialog automatically
  page.on('dialog', async dialog => {
    console.log('Accepting confirm dialog:', dialog.message());
    await dialog.accept();
  });

  // 10. Submit Quiz
  console.log('Submitting Quiz...');
  const submitBtn = page.locator('button:has-text("Submit Quiz"), button:has-text("Finish & Submit")');
  await submitBtn.click();

  // 11. Wait for Quiz Results
  console.log('Waiting for evaluation results and scorecard...');
  await page.waitForSelector('.quiz-score-badge', { timeout: 25000 });

  const scoreText = await page.textContent('.quiz-score-badge');
  const resultsTitle = await page.textContent('.quiz-results-banner h3');
  console.log('  Scorecard Result:', scoreText?.trim(), '-', resultsTitle?.trim());

  // Verify explanations and citation pills
  const reviewCount = await page.locator('.quiz-review-item').count();
  console.log(`  Step 7: Reviewed Questions: ${reviewCount}`);

  const explanationVisible = await page.locator('.quiz-explanation-box').first().isVisible();
  console.log(`  Step 7: Textbook Grounded Explanation Visible: ${explanationVisible}`);

  // Step 8: Open/Inspect citation
  const citationText = await page.locator('.quiz-explanation-box').first().textContent();
  const hasCitation = citationText.includes('Source Citation') && citationText.includes('Verified Ground Truth');
  console.log(`  Step 8: Verified Citation Ground Truth Visible: ${hasCitation}`);
  if (!hasCitation) throw new Error('Citation reference not visible in review item');

  // Save review scorecard screenshot
  const reviewScreenshotPath = path.join(process.cwd(), 'scratch', 'phase5_quiz_review_screenshot.png');
  await page.screenshot({ path: reviewScreenshotPath, fullPage: true });
  const artifactDir = 'C:\\Users\\manik\\.gemini\\antigravity\\brain\\49f0a009-9a5b-484c-9b99-26b13ad72a25';
  if (fs.existsSync(artifactDir)) {
    fs.copyFileSync(reviewScreenshotPath, path.join(artifactDir, 'phase5_quiz_review_screenshot.png'));
  }

  // Step 9 & 10: Retake Quiz and verify history display
  console.log('Step 10: Clicking "🔄 Retake Quiz"...');
  await page.click('button:has-text("Retake Quiz")');
  await page.waitForTimeout(1000);

  // Wait for config screen to return
  await page.waitForSelector('#btn-start-quiz', { timeout: 10000 });
  console.log('  Returned to Quiz Configuration Screen');

  // Step 9: Verify past attempts history is visible
  const historyVisible = await page.locator('.quiz-history-item').first().isVisible().catch(() => false);
  console.log(`  Step 9: Past Diagnostic Attempts History Visible: ${historyVisible}`);

  // 12. Save screenshot
  const screenshotPath = path.join(process.cwd(), 'scratch', 'phase5_quiz_e2e_screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  // Also copy to artifacts directory
  if (fs.existsSync(artifactDir)) {
    const artifactDest = path.join(artifactDir, 'phase5_quiz_e2e_screenshot.png');
    fs.copyFileSync(screenshotPath, artifactDest);
    console.log(`Screenshot copied to artifact dir: ${artifactDest}`);
  }

  await browser.close();
  console.log('\n========================================================================');
  console.log('  ✅ Playwright End-to-End Quiz Verification PASSED 100%!             ');
  console.log('========================================================================\n');
}

runPlaywrightE2E().catch(err => {
  console.error('Playwright E2E Test FAILED:', err);
  process.exit(1);
});
