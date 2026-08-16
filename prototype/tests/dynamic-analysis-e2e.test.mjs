import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAppServer } from '../server.mjs';
import { launchBrowser, resolvePlaywrightUrl } from '../scripts/browser-runtime.mjs';

async function startTestServer() {
  const server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
      server.closeIdleConnections();
    }),
  };
}

test('page provides dynamic input and result landmarks', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const id of ['business-input-region', 'financial-region']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /프로토타입 에이전트 모드/);
  assert.match(html, /로컬 LLM.*목표/);
  assert.doesNotMatch(html, /크로아티아|1억 1,200만원|5,200만원/);
  assert.match(html, /사업 정보를 입력하거나 선택적 합성 데모를 실행해 주세요/);
});

test('desktop and mobile users submit startup and operating inputs with consent-gated results', { timeout: 120_000 }, async (t) => {
  const { chromium } = await import(await resolvePlaywrightUrl());
  const service = await startTestServer();
  let browser;
  t.after(async () => {
    await browser?.close();
    await service.close();
  });
  browser = await launchBrowser(chromium);

  for (const viewport of [
    { label: 'desktop', width: 1440, height: 1000 },
    { label: 'mobile', width: 390, height: 844 },
  ]) {
    await t.test(viewport.label, async () => {
      const page = await browser.newPage({ viewport });
      const errors = [];
      let legacyAnalyzeCalls = 0;
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/analyze') legacyAnalyzeCalls += 1;
      });
      await page.goto(service.url, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-ready="true"]').waitFor();

      assert.equal(await page.locator('#businessName').inputValue(), '');
      assert.equal(legacyAnalyzeCalls, 0);
      assert.equal(await page.locator('[data-expert-opinion]').count(), 0);
      assert.match((await page.locator('#business-title').textContent()).trim(), /사업 정보를 입력/);
      await page.locator('[data-analysis-submit]').click();
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'districtCode');
      assert.equal(await page.locator('#districtCode').getAttribute('aria-invalid'), 'true');
      assert.equal(await page.locator('#districtCode-error').getAttribute('data-field-code'), 'REQUIRED');
      await page.locator('[data-fill-synthetic-demo]').click();
      assert.match(await page.locator('#businessName').inputValue(), /합성/);
      await page.locator('[data-add-custom-cost]').click();
      assert.equal(await page.locator('[data-custom-cost-id]').count(), 1);
      await page.locator('[data-remove-custom-cost]').click();
      assert.equal(await page.locator('[data-custom-cost-id]').count(), 0);
      await page.locator('[data-analysis-submit]').click();
      await page.locator('[data-comparison="calculated-budget"]').waitFor();
      assert.equal((await page.locator('[data-comparison="calculated-budget"] dd').textContent()).trim(), '112,000,000원');
      assert.ok(await page.locator('[data-benchmark-disclosure]').isVisible());
      assert.equal((await page.locator('[data-market-status="PLANNED_INTEGRATION"]').textContent()).trim(), 'PLANNED_INTEGRATION');
      assert.match(await page.locator('#market-region').textContent(), /외부 실시간 시장 데이터 제공자는 아직 연결되지 않았습니다/);
      assert.equal(await page.locator('[data-market-placeholder]').count(), 3);
      assert.equal(await page.locator('[data-market-scenarios]').count(), 0);

      await page.locator('[data-action="open-advisor-consent"]').click();
      await page.locator('#advisor-consent').check();
      await page.locator('#advisor-submit').click();
      await page.locator('[data-consultation-recorded]').waitFor();

      const sharedName = await page.locator('#businessName').inputValue();
      await page.locator('[data-path="operator"]').click();
      await page.locator('[data-path-confirmation]').waitFor();
      assert.equal(await page.locator('[data-stage="SITE_AND_FUNDING"]').getAttribute('aria-current'), 'step');
      assert.equal(await page.locator('[data-comparison="calculated-budget"]').count(), 1);
      await page.locator('[data-cancel-path]').click();
      assert.equal(await page.locator('[data-stage="SITE_AND_FUNDING"]').getAttribute('aria-current'), 'step');
      assert.equal(await page.locator('[data-consultation-recorded]').count(), 1);
      await page.locator('[data-path="operator"]').click();
      await page.locator('[data-path-confirmation]').waitFor();
      await page.locator('[data-confirm-path]').click();
      assert.equal(await page.locator('[data-stage="OPERATING"]').getAttribute('aria-current'), 'step');
      assert.equal(await page.locator('[data-comparison="calculated-budget"]').count(), 0);
      assert.equal(await page.locator('[data-consultation-recorded]').count(), 0);
      assert.equal((await page.locator('#business-title').textContent()).trim(), '사업 정보를 입력해 분석을 시작하세요');
      assert.equal((await page.locator('#analysis-kind').textContent()).trim(), '사용자 입력 분석');
      await page.locator('#question-form button[type="submit"]').click();
      await page.waitForTimeout(100);
      assert.equal(legacyAnalyzeCalls, 1, 'confirmed path changes must exit demo mode');
      assert.equal(await page.locator('#businessName').inputValue(), sharedName);
      assert.ok(await page.locator('#monthlySalesKrw').isVisible());
      for (const [name, value] of Object.entries({
        registrationStatus: 'REGISTERED', fundingPurpose: 'WORKING_CAPITAL', operatingMonths: '18',
        monthlySalesKrw: '20000000', declaredNetProfitKrw: '2000000', declaredMarginPercent: '10',
        laborCostKrw: '5000000', rentKrw: '2000000', materialCostKrw: '7000000', platformFeesKrw: '500000',
        advertisingKrw: '300000', utilitiesAndFeesKrw: '700000', otherCostKrw: '200000',
      })) {
        const control = page.locator(`[name="${name}"]`);
        if (await control.evaluate((node) => node.tagName === 'SELECT')) await control.selectOption(value);
        else await control.fill(value);
      }
      await page.locator('[data-analysis-submit]').click();
      await page.locator('[data-comparison="calculated-profit"]').waitFor();
      assert.equal((await page.locator('[data-comparison="calculated-profit"] dd').textContent()).trim(), '4,300,000원');
      assert.equal(await page.locator('[data-expert-opinion]').count(), 4);
      await page.locator('[data-policy-comparison] > summary').click();
      assert.ok(await page.locator('[data-official-policy-link]').first().isVisible());

      await page.locator('[data-action="open-advisor-consent"]').click();
      const submit = page.locator('#advisor-submit');
      assert.ok(await submit.isDisabled());
      await page.locator('#advisor-consent').check();
      assert.ok(await submit.isEnabled());
      await submit.click();
      await page.locator('[data-consultation-recorded]').waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    });
  }
});

test('a confirmed path change invalidates an in-flight analysis while preserving event alerts', { timeout: 60_000 }, async (t) => {
  const { chromium } = await import(await resolvePlaywrightUrl());
  const service = await startTestServer();
  let browser;
  t.after(async () => {
    await browser?.close();
    await service.close();
  });
  browser = await launchBrowser(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(service.url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-ready="true"]').waitFor();
  await page.locator('[data-fill-synthetic-demo]').click();
  await page.locator('[data-action="simulate-cost-spike"]').click();
  await page.locator('[data-immediate-alert]').waitFor({ state: 'visible' });

  let releaseResponse;
  let markRequestStarted;
  const requestStarted = new Promise((resolve) => { markRequestStarted = resolve; });
  const responseReleased = new Promise((resolve) => { releaseResponse = resolve; });
  await page.route('**/api/analysis', async (route) => {
    const response = await route.fetch();
    markRequestStarted();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({ response });
    releaseResponse();
  });

  await page.locator('[data-analysis-submit]').click();
  await requestStarted;
  await page.locator('[data-path="operator"]').click();
  await page.locator('[data-path-confirmation]').waitFor();
  await page.locator('[data-confirm-path]').click();
  await responseReleased;

  assert.equal(await page.locator('[data-stage="OPERATING"]').getAttribute('aria-current'), 'step');
  assert.equal(await page.locator('[data-comparison="calculated-budget"]').count(), 0);
  assert.ok(await page.locator('[data-immediate-alert]').isVisible());
});

test('custom-cost structural edits exit explicit demo mode', { timeout: 60_000 }, async (t) => {
  const { chromium } = await import(await resolvePlaywrightUrl());
  const service = await startTestServer();
  let browser;
  t.after(async () => {
    await browser?.close();
    await service.close();
  });
  browser = await launchBrowser(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let legacyCalls = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/analyze') legacyCalls += 1;
  });
  await page.goto(service.url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-ready="true"]').waitFor();
  await page.locator('[data-fill-synthetic-demo]').click();
  await page.getByRole('heading', { level: 2, name: '서울 성동구 크로아티아 음식점', exact: true }).waitFor();
  await page.locator('[data-add-custom-cost]').click();
  assert.equal((await page.locator('#analysis-kind').textContent()).trim(), '사용자 입력 분석');
  await page.locator('#question-form button[type="submit"]').click();
  await page.waitForTimeout(100);
  assert.equal(legacyCalls, 1);
});

test('generic stage, question, and cost actions never enter the synthetic demo', { timeout: 60_000 }, async (t) => {
  const { chromium } = await import(await resolvePlaywrightUrl());
  const service = await startTestServer();
  let browser;
  t.after(async () => {
    await browser?.close();
    await service.close();
  });
  browser = await launchBrowser(chromium);

  for (const action of ['stage', 'question', 'cost']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let legacyAnalyzeCalls = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/analyze') legacyAnalyzeCalls += 1;
    });
    await page.goto(service.url, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-ready="true"]').waitFor();
    if (action === 'stage') await page.locator('[data-stage="OPENING"]').click();
    if (action === 'question') await page.locator('#question-form button[type="submit"]').click();
    if (action === 'cost') {
      await page.locator('[data-action="simulate-cost-spike"]').click();
      await page.locator('[data-immediate-alert]').waitFor({ state: 'visible' });
    }
    await page.waitForTimeout(100);
    assert.equal(legacyAnalyzeCalls, 0, `${action} must not call the legacy demo endpoint`);
    assert.equal((await page.locator('#business-title').textContent()).trim(), '사업 정보를 입력해 분석을 시작하세요');
    assert.equal((await page.locator('#analysis-kind').textContent()).trim(), '사용자 입력 분석');
    assert.doesNotMatch(await page.locator('body').textContent(), /크로아티아/);
    assert.match((await page.locator('#partner-status').textContent()).trim(), /사업 정보를.*분석/);
    await page.close();
  }

  const genericPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let genericLegacyCalls = 0;
  let dynamicAnalysisCalls = 0;
  genericPage.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/analyze') genericLegacyCalls += 1;
    if (pathname === '/api/analysis') dynamicAnalysisCalls += 1;
  });
  await genericPage.goto(service.url, { waitUntil: 'domcontentloaded' });
  await genericPage.locator('[data-ready="true"]').waitFor();
  await genericPage.locator('#districtCode').selectOption('SEONGDONG');
  await genericPage.locator('#neighborhoodName').fill('성수동');
  await genericPage.locator('#businessName').fill('사용자 입력 사업');
  await genericPage.locator('#businessDescription').fill('사용자가 직접 입력한 일반 사업 분석입니다.');
  for (const [name, value] of Object.entries({
    declaredTotalBudgetKrw: '112000000', ownCapitalKrw: '60000000', depositKrw: '30000000',
    interiorCostKrw: '40000000', equipmentCostKrw: '30000000', initialInventoryKrw: '10000000',
    permitsMarketingKrw: '2000000', otherCostKrw: '0',
  })) await genericPage.locator(`[name="${name}"]`).fill(value);
  for (const selector of ['[data-stage="OPENING"]', '#question-form button[type="submit"]']) {
    await genericPage.locator(selector).click();
    await genericPage.waitForTimeout(100);
    assert.equal(dynamicAnalysisCalls, selector.includes('OPENING') ? 1 : 2, 'valid unsent startup input must use /api/analysis');
  }
  const costResponse = genericPage.waitForResponse((candidate) => new URL(candidate.url()).pathname === '/api/analysis');
  await genericPage.locator('[data-action="simulate-cost-spike"]').click();
  await costResponse;
  await genericPage.locator('[data-immediate-alert]').waitFor({ state: 'visible' });
  assert.equal(dynamicAnalysisCalls, 3);
  assert.equal(genericLegacyCalls, 0);
  assert.equal((await genericPage.locator('#analysis-kind').textContent()).trim(), '사용자 입력 분석');
  assert.doesNotMatch(await genericPage.locator('body').textContent(), /크로아티아/);
  await genericPage.close();

  const operatingPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let operatingLegacyCalls = 0;
  let operatingDynamicCalls = 0;
  operatingPage.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/analyze') operatingLegacyCalls += 1;
    if (pathname === '/api/analysis') operatingDynamicCalls += 1;
  });
  await operatingPage.goto(service.url, { waitUntil: 'domcontentloaded' });
  await operatingPage.locator('[data-ready="true"]').waitFor();
  await operatingPage.locator('[data-path="operator"]').click();
  await operatingPage.locator('#districtCode').selectOption('SEONGDONG');
  await operatingPage.locator('#neighborhoodName').fill('성수동');
  await operatingPage.locator('#registrationStatus').selectOption('REGISTERED');
  await operatingPage.locator('#businessName').fill('사용자 운영 사업');
  await operatingPage.locator('#businessDescription').fill('사용자가 직접 입력한 운영 사업 분석입니다.');
  for (const [name, value] of Object.entries({
    operatingMonths: '18', monthlySalesKrw: '20000000', declaredNetProfitKrw: '2000000', declaredMarginPercent: '10',
    laborCostKrw: '5000000', rentKrw: '2000000', materialCostKrw: '7000000', platformFeesKrw: '500000',
    advertisingKrw: '300000', utilitiesAndFeesKrw: '700000', otherCostKrw: '200000',
  })) await operatingPage.locator(`[name="${name}"]`).fill(value);
  await operatingPage.locator('#question-form button[type="submit"]').click();
  await operatingPage.waitForTimeout(100);
  assert.equal(operatingDynamicCalls, 1, 'valid unsent operating input must use /api/analysis');
  assert.equal(operatingLegacyCalls, 0);
  await operatingPage.locator('[data-comparison="calculated-profit"]').waitFor();
  await operatingPage.close();

  const demoPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let demoLegacyCalls = 0;
  demoPage.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/analyze') demoLegacyCalls += 1;
  });
  await demoPage.goto(service.url, { waitUntil: 'domcontentloaded' });
  await demoPage.locator('[data-ready="true"]').waitFor();
  await demoPage.locator('[data-fill-synthetic-demo]').click();
  await demoPage.getByRole('heading', { level: 2, name: '서울 성동구 크로아티아 음식점', exact: true }).waitFor();
  assert.equal(demoLegacyCalls, 1);
  assert.equal((await demoPage.locator('#analysis-kind').textContent()).trim(), '선택적 합성 데모 분석');
  await demoPage.locator('[data-add-custom-cost]').click();
  assert.equal((await demoPage.locator('#analysis-kind').textContent()).trim(), '사용자 입력 분석');
  assert.equal((await demoPage.locator('#business-title').textContent()).trim(), '사업 정보를 입력해 분석을 시작하세요');
  await demoPage.locator('#question-form button[type="submit"]').click();
  await demoPage.waitForTimeout(100);
  assert.equal(demoLegacyCalls, 1, 'adding a custom cost must exit demo mode');
  await demoPage.locator('[data-remove-custom-cost]').click();
  await demoPage.locator('#question-form button[type="submit"]').click();
  await demoPage.waitForTimeout(100);
  assert.equal(demoLegacyCalls, 1, 'removing a custom cost must remain outside demo mode');
  await demoPage.locator('[data-fill-synthetic-demo]').click();
  await demoPage.getByRole('heading', { level: 2, name: '서울 성동구 크로아티아 음식점', exact: true }).waitFor();
  assert.equal(demoLegacyCalls, 2);
  await demoPage.locator('#businessName').fill('사용자 일반 사업');
  assert.equal((await demoPage.locator('#business-title').textContent()).trim(), '사업 정보를 입력해 분석을 시작하세요');
  assert.equal((await demoPage.locator('#analysis-kind').textContent()).trim(), '사용자 입력 분석');
  await demoPage.locator('#question-form button[type="submit"]').click();
  await demoPage.waitForTimeout(100);
  assert.equal(demoLegacyCalls, 2, 'editing user input must exit demo mode');
});
