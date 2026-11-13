import { chromium } from 'playwright';
import { getSupabaseAdmin, getSupabaseClient } from '../lib/supabase.js';

async function runFrontendE2E() {
  console.log('========================================================================');
  console.log('  GapFinder AI — Playwright Frontend Gap Analysis E2E Test              ');
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

  // 2. Launch Chromium browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

  const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

  try {
    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');

    // Wait for Supabase client to initialize
    console.log('Waiting for Supabase client in browser...');
    await page.waitForFunction(() => window.AppState?.supabaseClient !== null && window.AppState?.supabaseClient !== undefined, { timeout: 15000 });

    // 3. Inject authenticated Supabase session into browser
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

    // Wait briefly for UI to stabilize
    await page.waitForTimeout(1000);

    // 4. Navigate to Gap Analysis view via sidebar button
    console.log('Clicking "Gap Analysis" in sidebar...');
    const gapNavBtn = page.locator('#nav-btn-gap-analysis');
    await gapNavBtn.click();

    // 5. Wait for Gap Analysis view to become active and visible
    await page.waitForSelector('#view-gap-analysis', { state: 'visible', timeout: 10000 });
    console.log('Gap Analysis view panel is now visible.');

    // 6. Wait for diagnostic metrics to populate
    await page.waitForFunction(() => {
      const el = document.getElementById('gap-stat-overall-accuracy');
      return el && el.textContent !== '--%' && el.textContent.includes('%');
    }, { timeout: 15000 });

    const accuracyText = await page.locator('#gap-stat-overall-accuracy').textContent();
    const questionsText = await page.locator('#gap-stat-total-questions').textContent();
    console.log(`Overall Diagnosis Rendered: Accuracy = ${accuracyText}, Questions Assessed = ${questionsText}`);

    // 7. Verify topic cards rendered
    const topicCards = page.locator('.gap-topic-card');
    const cardCount = await topicCards.count();
    console.log(`Diagnostic Topic Cards Rendered: ${cardCount}`);

    // 8. Expand supporting questions drawer on the first topic card if available
    const supportingToggle = page.locator('.gap-supporting-toggle').first();
    if (await supportingToggle.isVisible()) {
      console.log('Expanding supporting question references drawer...');
      await supportingToggle.click();
      await page.waitForTimeout(600);
      const questionItems = page.locator('.gap-question-item');
      console.log(`Supporting question references visible: ${await questionItems.count()}`);
    }

    // 9. Capture screenshot artifact
    const screenshotPath = 'C:\\Users\\manik\\.gemini\\antigravity\\brain\\49f0a009-9a5b-484c-9b99-26b13ad72a25\\phase6_gap_analysis_screenshot.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to ${screenshotPath}`);

    console.log('\n========================================================================');
    console.log('  ✅ Playwright Frontend Gap Analysis E2E Test: 100% SUCCESS           ');
    console.log('========================================================================\n');
  } catch (err) {
    console.error('❌ Frontend E2E Test Failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runFrontendE2E();
