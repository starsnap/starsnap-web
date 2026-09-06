// Run against `npm run dev`: REVIEW_WEB_URL=http://localhost:3000 node scripts/check-snap-edit.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const baseUrl = process.env.REVIEW_WEB_URL || 'http://localhost:3000';
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADLESS === 'true' });
const original = {
    createdUser: { username: 'review' },
    snapData: {
        snapId: 'review-snap', title: 'Before', tags: [], photos: [], comments: [],
        commentState: true, starIds: ['original-star'], starGroupIds: ['original-group'],
    },
};

try {
    for (const scenario of ['pending', 'failed', 'outside-page', 'remove-all', 'add']) {
        const context = await browser.newContext();
        let release;
        const metadataReady = new Promise(resolve => { release = resolve; });
        let submitted;
        const saved = new Promise(resolve => { submitted = resolve; });
        await context.addInitScript(feedItem => {
            localStorage.setItem('starsnap-authenticated', 'true');
            history.replaceState({ usr: { feedItem, canEdit: true }, key: 'review', idx: 0 }, '');
        }, original);
        await context.route('**/api/**', async route => {
            const request = route.request();
            const path = new URL(request.url()).pathname;
            if (path === '/api/snap/update') {
                const form = await new Response(request.postDataBuffer(), {
                    headers: { 'Content-Type': request.headers()['content-type'] },
                }).formData();
                const updated = { ...original, snapData: {
                    ...original.snapData, title: form.get('title'),
                    starIds: form.getAll('starIds'), starGroupIds: form.getAll('starGroupIds'),
                } };
                await route.fulfill({ json: updated });
                submitted(form);
                return;
            }
            if (path === '/api/star' || path === '/api/star-group') {
                if (scenario === 'pending') await metadataReady;
                await route.fulfill(scenario === 'failed'
                    ? { status: 503, json: { message: 'Metadata unavailable' } }
                    : { json: { content: scenario === 'add' && new URL(request.url()).searchParams.get('size') !== '500'
                        ? [{ id: path === '/api/star' ? 'new-star' : 'new-group', name: path === '/api/star' ? '추가 스타' : '추가 그룹' }]
                        : [], last: true } });
                return;
            }
            await route.fulfill({ json: path.includes('/user')
                ? { userId: 'review', username: 'review', authority: 'USER', state: true }
                : { ...original, content: [], last: true } });
        });
        const page = await context.newPage();
        await page.goto(`${baseUrl}/snap/review-snap/edit`, {
            waitUntil: scenario === 'pending' ? 'domcontentloaded' : 'networkidle',
        });
        await page.getByPlaceholder('스냅 제목을 입력하세요').fill(`After ${scenario}`);
        if (scenario === 'remove-all') {
            await page.getByRole('button', { name: '연결된 스타 1 제거' }).click();
            await page.getByRole('button', { name: '연결된 그룹 1 제거' }).click();
        }
        if (scenario === 'add') {
            await page.getByText('스타', { exact: true }).locator('..').getByRole('button').first().click();
            await page.getByRole('button', { name: '추가 스타' }).click();
            await page.getByRole('button', { name: '확인 (2)', exact: true }).click();
            await page.getByText('스타그룹', { exact: true }).locator('..').getByRole('button').first().click();
            await page.getByRole('button', { name: '추가 그룹', exact: true }).click();
            await page.getByRole('button', { name: '확인 (2)', exact: true }).click();
        }
        await page.getByRole('button', { name: '수정 완료', exact: true }).click();
        const form = await saved;
        const starIds = scenario === 'remove-all' ? [] : scenario === 'add' ? ['original-star', 'new-star'] : ['original-star'];
        const groupIds = scenario === 'remove-all' ? [] : scenario === 'add' ? ['original-group', 'new-group'] : ['original-group'];
        assert.deepEqual(form.getAll('starIds'), starIds);
        assert.deepEqual(form.getAll('starGroupIds'), groupIds);
        assert.equal(form.get('_starIds'), 'on');
        assert.equal(form.get('_starGroupIds'), 'on');
        release();
        await page.waitForURL('**/snap/review-snap');
        assert.deepEqual(await page.evaluate(() => history.state.usr.feedItem.snapData.starIds),
            starIds);
        await context.close();
        console.log(`PASS snap edit: ${scenario}`);
    }

    const context = await browser.newContext({ timezoneId: 'Asia/Seoul' });
    await context.addInitScript(() => localStorage.setItem('starsnap-authenticated', 'true'));
    await context.route('**/api/**', route => route.fulfill({ json: { content: [], username: 'review' } }));
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-09-05T16:00:00Z') });
    await page.goto(`${baseUrl}/add`);
    assert.equal(await page.locator('input[type="date"]').inputValue(), '2026-09-06');
    await context.close();
    console.log('PASS photo date: KST early morning');
} finally {
    await browser.close();
}
