import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAppServer } from '../server.mjs';
import { launchBrowser, resolvePlaywrightUrl } from '../scripts/browser-runtime.mjs';

async function startTestServer() {
  const server = createAppServer({
    now: () => new Date('2026-08-03T00:00:00.000Z'),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
      server.closeIdleConnections();
    }),
  };
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    dimensions.contentWidth <= dimensions.viewportWidth,
    `${label} overflows horizontally: ${dimensions.contentWidth}px > ${dimensions.viewportWidth}px`,
  );
}

test('SPA contains accessible lifecycle, council, policy, market and advisor regions', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const id of ['lifecycle-region', 'council-region', 'policy-region', 'market-region', 'advisor-region']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /<main/);
  assert.match(html, /aria-live=/);
});

test('real browser preserves the verified lifecycle journey on desktop and mobile', { timeout: 90_000 }, async (t) => {
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
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      await page.addInitScript(({ fixedNow }) => {
        const NativeDate = Date;
        class FixedDate extends NativeDate {
          constructor(...args) {
            super(...(args.length === 0 ? [fixedNow] : args));
          }

          static now() {
            return new NativeDate(fixedNow).getTime();
          }
        }
        globalThis.Date = FixedDate;
      }, { fixedNow: '2026-08-03T00:00:00.000Z' });
      const browserErrors = [];
      let legacyAnalyzeCalls = 0;
      page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
      });
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/analyze') legacyAnalyzeCalls += 1;
      });

      await page.goto(service.url, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-ready="true"]').waitFor({ timeout: 2_000 });

      assert.equal(await page.title(), 'KB 비즈니스 라이프사이클 파트너');
      const pageHeading = page.getByRole('heading', { level: 1, name: '사업의 다음 결정을 함께 점검하는 AI 파트너', exact: true });
      assert.ok(await pageHeading.isVisible());
      assert.equal(await page.locator('[data-expert-opinion]').count(), 0);
      await page.locator('[data-stage="OPENING"]').click();
      await page.locator('#question-form button[type="submit"]').click();
      await page.locator('[data-action="simulate-cost-spike"]').click();
      await page.locator('[data-immediate-alert]').waitFor({ state: 'visible' });
      assert.equal(legacyAnalyzeCalls, 0);
      assert.equal((await page.locator('#business-title').textContent()).trim(), '사업 정보를 입력해 분석을 시작하세요');
      assert.equal((await page.locator('#analysis-kind').textContent()).trim(), '사용자 입력 분석');
      assert.equal(await page.locator('#districtCode').getAttribute('aria-invalid'), 'true');
      assert.match((await page.locator('#partner-status').textContent()).trim(), /필수·형식 오류.*사용자 입력 기반 분석/);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('[data-ready="true"]').waitFor();
      await page.locator('[data-fill-synthetic-demo]').click();
      const fundingGap = page.locator('[data-finance-fact="funding-gap"][data-value="52000000"] dd');
      await fundingGap.waitFor();
      assert.equal(legacyAnalyzeCalls, 1);
      assert.ok(await fundingGap.isVisible());
      assert.equal((await fundingGap.textContent()).trim(), '5,200만원');
      const opinions = page.locator('[data-expert-opinion]');
      assert.equal(await opinions.count(), 4);
      for (const [index, expert] of ['MARKET', 'OPERATIONS', 'FINANCE', 'POLICY'].entries()) {
        const opinion = opinions.nth(index);
        assert.ok(await opinion.isVisible(), `${expert} opinion should be visible`);
        assert.equal((await opinion.locator('h3').textContent()).trim(), `${expert} 전문 의견`);
        assert.notEqual((await opinion.locator('p').first().textContent()).trim(), '');
      }
      await assertNoHorizontalOverflow(page, `${viewport.label} initial`);

      await page.locator('[data-policy-comparison] > summary').click();
      const officialPolicyLink = page.locator('[data-official-policy-link]').first();
      assert.ok(await officialPolicyLink.isVisible());
      assert.equal((await officialPolicyLink.textContent()).trim(), '공식 원문 열기');
      assert.equal(await officialPolicyLink.getAttribute('href'), 'https://www.mss.go.kr/site/smba/ex/bbs/View.do?bcIdx=1064353&cbIdx=310');
      await assertNoHorizontalOverflow(page, `${viewport.label} expanded policy`);

      const marketScenarios = page.locator('[data-market-scenarios]');
      const baselineScenario = marketScenarios.locator('div').nth(1);
      assert.ok(await baselineScenario.isVisible());
      assert.equal((await baselineScenario.textContent()).replaceAll(/\s/g, ''), '기준지수100');
      const marketBefore = await marketScenarios.textContent();
      await page.locator('[data-action="simulate-cost-spike"]').click();
      const immediateAlert = page.locator('[data-immediate-alert]');
      await immediateAlert.waitFor({ state: 'visible' });
      assert.equal(
        (await immediateAlert.textContent()).trim(),
        '즉시 알림: INGREDIENT_COST_SPIKE was reported and needs timely review; the available signal does not establish a final outcome.',
      );
      await page.waitForFunction(
        ([selector, previous]) => document.querySelector(selector)?.textContent !== previous,
        ['[data-market-scenarios]', marketBefore],
      );
      assert.equal((await baselineScenario.textContent()).replaceAll(/\s/g, ''), '기준지수95');
      await assertNoHorizontalOverflow(page, `${viewport.label} crisis`);

      await page.locator('[data-action="open-advisor-consent"]').click();
      const consentDialog = page.getByRole('dialog', { name: '전문가 연결 동의', exact: true });
      await consentDialog.waitFor({ state: 'visible' });
      const advisorAction = consentDialog.locator('[data-advisor-action]');
      assert.ok(await advisorAction.isVisible());
      assert.equal((await advisorAction.textContent()).trim(), '전문가 연결 요청');
      assert.ok(await advisorAction.isDisabled());
      await consentDialog.locator('#advisor-consent').check();
      assert.ok(await advisorAction.isEnabled());
      await assertNoHorizontalOverflow(page, `${viewport.label} advisor dialog`);

      await page.locator('[data-action="close-advisor-consent"]').click();
      await page.locator('[data-path="operator"]').click();
      await page.locator('[data-path-confirmation]').waitFor();
      await page.locator('[data-confirm-path]').click();
      const restriction = page.locator('[data-operator-stage-restriction]');
      await restriction.waitFor();
      assert.equal((await restriction.textContent()).trim(), '기존 운영 경로에서는 운영 및 위기 대응 단계만 선택할 수 있습니다.');
      for (const stage of ['PRE_START', 'SITE_AND_FUNDING', 'OPENING']) {
        assert.ok(await page.locator(`[data-stage="${stage}"]`).isDisabled());
      }
      for (const stage of ['OPERATING', 'CRISIS']) {
        assert.ok(await page.locator(`[data-stage="${stage}"]`).isEnabled());
      }

      await assertNoHorizontalOverflow(page, `${viewport.label} operator`);
      assert.deepEqual(browserErrors, []);
      await page.close();
    });
  }
});
