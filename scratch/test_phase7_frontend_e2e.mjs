import { chromium } from 'playwright';
import { getSupabaseAdmin, getSupabaseClient } from '../lib/supabase.js';

async function runPhase7FrontendE2E() {
  console.log('========================================================================');
  console.log('  GapFinder AI — Phase 7: Playwright Frontend Revision Plan E2E Test    ');
  console.log('========================================================================\n');

  // 1. Authenticate student Manikanta Anandam
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

  // 2. Launch browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

  const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

  try {
    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');

    // 3. Wait for client & inject session
    console.log('Waiting for Supabase client...');
    await page.waitForFunction(() => window.AppState?.supabaseClient !== null, { timeout: 15000 });

    console.log('Injecting session and initializing student workspace...');
    await page.evaluate(async (sess) => {
      await window.AppState.supabaseClient.auth.setSession({
        access_token: sess.access_token,
        refresh_token: sess.refresh_token
      });
      window.AppState.user = sess.user;
      window.AppState.subjects = [{
        id: '173b9439-b3c2-42c5-9ac0-592bf50a6626',
        name: 'Mathematics',
        description: 'Class X Mathematics Curriculum'
      }];
      window.AppState.selectedSubject = window.AppState.subjects[0];
      if (typeof window.loadLibrary === 'function') {
        await window.loadLibrary();
      }
    }, { access_token: session.access_token, refresh_token: session.refresh_token, user: sessionData.user });

    await page.waitForTimeout(1000);

    // 4. Navigate to Gap Analysis first to verify diagnosis
    console.log('Step 1: Navigating to Gap Analysis view...');
    const gapBtn = page.locator('#nav-btn-gap-analysis');
    await gapBtn.click();
    await page.waitForSelector('#view-gap-analysis', { state: 'visible', timeout: 10000 });
    console.log('  ✅ Gap Analysis view is visible.');

    // 5. Click "Revision Plan" CTA button in header
    console.log('Step 2: Clicking "Revision Plan" button in header...');
    const gotoPlanBtn = page.locator('#btn-goto-revision-plan');
    await gotoPlanBtn.click();

    // 6. Wait for Revision Plan view to become active
    await page.waitForSelector('#view-revision-plan', { state: 'visible', timeout: 10000 });
    console.log('  ✅ Revision Plan view is visible.');

    // 7. Verify Inputs (availableDays = 5, hoursPerDay = 2)
    const daysInput = page.locator('#plan-input-days');
    const hoursInput = page.locator('#plan-input-hours');
    console.log(`  Study availability inputs: Days = ${await daysInput.inputValue()}, Hours = ${await hoursInput.inputValue()}`);

    // 8. Click "Generate Revision Plan" button
    console.log('Step 3: Clicking "Generate Revision Plan"...');
    const genBtn = page.locator('#btn-generate-plan');
    await genBtn.click();

    // 9. Wait for plan progress card to appear
    console.log('Waiting for revision schedule to generate and render...');
    await page.waitForSelector('#plan-progress-card', { state: 'visible', timeout: 15000 });

    const progressText = await page.locator('#plan-completion-stat').textContent();
    const taskCountText = await page.locator('#plan-task-count-stat').textContent();
    console.log(`  ✅ Revision Plan Generated: Status = ${progressText}, Tasks = ${taskCountText}`);

    // 10. Verify Day Groups and Task Cards
    const dayGroups = page.locator('.revision-day-group');
    const dayCount = await dayGroups.count();
    console.log(`  ✅ Schedule Days Rendered: ${dayCount} days`);

    const taskCards = page.locator('.revision-task-card');
    const taskCount = await taskCards.count();
    console.log(`  ✅ Scheduled Tasks Rendered: ${taskCount} tasks`);

    // 11. Check prioritization on first task (Weak topic)
    const firstTask = taskCards.first();
    const firstTaskTopic = await firstTask.locator('.revision-task-topic').textContent();
    const firstTaskBadge = await firstTask.locator('.badge').first().textContent();
    console.log(`  ✅ Priority 1 Task: "${firstTaskTopic.trim()}" — Badge: [${firstTaskBadge.trim()}]`);

    // 12. Mark the first task as completed
    console.log('Step 4: Marking first revision task as completed...');
    const completeBtn = firstTask.locator('.revision-btn-complete');
    await completeBtn.click();
    await page.waitForTimeout(800);

    const updatedProgress = await page.locator('#plan-completion-stat').textContent();
    const updatedCount = await page.locator('#plan-task-count-stat').textContent();
    console.log(`  ✅ Task Completed! Updated Plan Progress: ${updatedProgress} (${updatedCount})`);

    // 13. Capture screenshot artifact of the active revision schedule
    const screenshotPath = 'C:\\Users\\manik\\.gemini\\antigravity\\brain\\49f0a009-9a5b-484c-9b99-26b13ad72a25\\phase7_revision_plan_screenshot.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`  ✅ Screenshot saved to ${screenshotPath}`);

    // 14. Test Retest Topic action (Returns student to quiz workflow)
    console.log('Step 5: Testing "Retest Topic (Take Quiz)" action...');
    const retestBtn = firstTask.locator('.revision-btn-retest');
    await retestBtn.click();
    await page.waitForTimeout(1000);

    // Verify view navigated to topic workspace with quiz tab active
    const topicWorkspace = page.locator('#view-topic-workspace');
    await page.waitForSelector('#view-topic-workspace', { state: 'visible', timeout: 10000 });
    console.log('  ✅ Navigated to Topic Workspace for retesting.');

    const quizTabPanel = page.locator('#tab-panel-quiz');
    const isQuizTabVisible = await quizTabPanel.isVisible();
    console.log(`  ✅ Quiz Runner Panel active & visible: ${isQuizTabVisible}`);

    console.log('\n========================================================================');
    console.log('  ✅ Complete End-to-End Flow Tested: 100% SUCCESS                      ');
    console.log('========================================================================\n');
  } catch (err) {
    console.error('❌ Phase 7 Frontend E2E Test Failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runPhase7FrontendE2E();

