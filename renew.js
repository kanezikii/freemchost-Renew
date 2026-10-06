const { chromium } = require('playwright');
const fs = require('fs');

if (!fs.existsSync('screenshots')) {
  fs.mkdirSync('screenshots');
}

// Telegram 通知工具
async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
    });
    console.log('📢 TG 通知已发送！');
  } catch (err) {
    console.error('❌ TG 通知发送失败:', err.message);
  }
}

// 🛡️ 深度清理评分/反馈弹窗、Cookie 协议横幅及半透明遮罩
async function closeAllModals(page) {
  // 1. 处理底部 Cookie 授权横幅
  try {
    const cookieBtn = page.locator('button').filter({ hasText: /^(accept all|reject all)$/i }).first();
    if (await cookieBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await cookieBtn.click({ force: true });
      await page.waitForTimeout(300);
    }
  } catch (e) {}

  // 2. 清理多层评分与反馈弹窗
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});

    const maybeLater = page.locator(':is(button, a, div[role="button"]):visible').filter({ hasText: /maybe later/i });
    const count = await maybeLater.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      await maybeLater.nth(i).click({ force: true }).catch(() => {});
    }

    await page.evaluate(() => {
      document.querySelectorAll('button, svg, [role="button"]').forEach(el => {
        const txt = (el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        if (['×', '✕', 'x'].includes(txt) || aria.includes('close')) {
          try { el.click(); } catch (e) {}
        }
      });

      // 仅移除评分与反馈遮罩，不误删续期弹窗
      const overlays = document.querySelectorAll('[role="dialog"], div.fixed.inset-0, div[class*="backdrop"]');
      overlays.forEach(el => {
        const txt = el.innerText || '';
        if (txt.includes('How would you rate') || txt.includes('Got an idea')) {
          el.remove();
        }
      });
      document.body.style.overflow = 'auto';
      document.body.style.pointerEvents = 'auto';
    });
    await page.waitForTimeout(300);
  }
}

// 🕒 精准提取剩余时间 (如: 01天 07小时 50分钟)
async function getExpiryTimeText(page) {
  try {
    const result = await page.evaluate(() => {
      const allNodes = Array.from(document.querySelectorAll('*'));
      const expiryHeader = allNodes.find(el => 
        el.children.length === 0 && (el.textContent || '').toUpperCase().includes('TIME UNTIL EXPIRY')
      );

      if (expiryHeader) {
        let container = expiryHeader.parentElement;
        for (let i = 0; i < 4; i++) {
          if (container && container.innerText.includes('D') && container.innerText.includes('H')) {
            break;
          }
          if (container && container.parentElement) {
            container = container.parentElement;
          }
        }

        if (container) {
          const text = container.innerText;
          const daysMatch = text.match(/(\d{1,2})\s*\n?\s*D/i);
          const hoursMatch = text.match(/(\d{1,2})\s*\n?\s*H/i);
          const minsMatch = text.match(/(\d{1,2})\s*\n?\s*M/i);

          if (daysMatch && hoursMatch) {
            const days = parseInt(daysMatch[1], 10);
            const hours = parseInt(hoursMatch[1], 10);
            const mins = minsMatch ? parseInt(minsMatch[1], 10) : 0;
            return `${days}天 ${hours}小时 ${mins}分钟`;
          }
        }
      }
      return null;
    });

    return result || '未知';
  } catch (e) {
    return '未知';
  }
}

// 🧮 将时间字符串转换为总小时数
function parseTimeToHours(timeStr) {
  if (!timeStr || timeStr === '未知') return 0;
  let totalHours = 0;
  const dayMatch = timeStr.match(/(\d+)\s*天/);
  const hourMatch = timeStr.match(/(\d+)\s*小时/);
  if (dayMatch) totalHours += parseInt(dayMatch[1], 10) * 24;
  if (hourMatch) totalHours += parseInt(hourMatch[1], 10);
  return totalHours;
}

(async () => {
  const email = process.env.FREE_EMAIL;
  const password = process.env.FREE_PASSWORD;
  const serverPageUrl = process.env.SERVER_PAGE_URL;
  const proxyUrl = process.env.PROXY_URL;
  const tgToken = process.env.TG_BOT_TOKEN;
  const tgChatId = process.env.TG_CHAT_ID;

  console.log('🚀 正在启动伪装浏览器...');

  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080'
    ]
  };

  if (proxyUrl) {
    console.log(`🌐 正在初始化代理网络: ${proxyUrl}`);
    launchOptions.proxy = { server: proxyUrl };
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US'
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    console.log('🚀 正在打开 Freemchost 登录页面...');
    await page.goto('https://freemchost.com/login', { waitUntil: 'networkidle', timeout: 60000 });

    console.log('📝 正在输入账号密码...');
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);

    console.log('🔐 正在尝试登录...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }),
      page.click('button[type="submit"]')
    ]);

    console.log('✅ 登录成功！当前 URL:', page.url());

    if (serverPageUrl) {
      console.log('📂 正在进入指定服务器页面:', serverPageUrl);
      await page.goto(serverPageUrl, { waitUntil: 'networkidle', timeout: 60000 });
    } else {
      console.log('📂 正在访问服务列表主页: https://freemchost.com/app');
      await page.goto('https://freemchost.com/app', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(2000);
      
      const firstServerLink = page.locator('a[href*="/app/servers/"]').first();
      if (await firstServerLink.count() > 0) {
        console.log('👉 点击第一个服务器卡片...');
        await firstServerLink.click();
        await page.waitForLoadState('networkidle');
      }
    }

    await page.waitForTimeout(2500);
    await closeAllModals(page);

    // 检查配置更新卡片
    const updateOfferBtn = page.getByRole('button', { name: /Update to current offer/i }).first();
    if (await updateOfferBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('⚡ 检测到配置需要更新，正在点击 [Update to current offer]...');
      await updateOfferBtn.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);
      await closeAllModals(page);
    }

    console.log('📌 正在切换至 [PLAN / Billing] 选项卡...');
    const billingTabLocator = page.locator('button[role="tab"]').filter({ hasText: /billing/i }).first();
    await billingTabLocator.waitFor({ state: 'attached', timeout: 15000 });

    for (let retry = 1; retry <= 3; retry++) {
      await closeAllModals(page);

      await billingTabLocator.click({ force: true }).catch(() => {});
      await page.evaluate(() => {
        const tab = document.querySelector('button[role="tab"][id*="trigger-billing"], button[role="tab"][aria-controls*="billing"]');
        if (tab) tab.click();
      });

      const isActivated = await page.waitForFunction(() => {
        const text = document.body.innerText || '';
        return text.includes('TIME UNTIL EXPIRY') || text.includes('Plan & lifecycle');
      }, { timeout: 3500 }).then(() => true).catch(() => false);

      if (isActivated) {
        console.log('✅ 已成功激活 [PLAN / Billing] 面板！');
        break;
      }
      console.log(`⏳ 第 ${retry} 次尝试激活 Billing 面板...`);
    }

    await page.waitForTimeout(1500);

    // 🕒 获取续期前的初始时间
    const currentExpiryTime = await getExpiryTimeText(page);
    const beforeHours = parseTimeToHours(currentExpiryTime);
    console.log(`📌 抓取到的当前服务器剩余时间: ${currentExpiryTime} (约 ${beforeHours} 小时)`);

    // 🔄 寻找并点击红色 [Renew now] 按钮 (DOM 穿透原生点击)
    console.log('🔄 正在寻找并点击红色 [Renew now] 按钮...');
    const renewClicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button, a, div[role="button"], div, span'));
      for (const el of all) {
        const txt = (el.innerText || '').trim();
        if (/renew now/i.test(txt)) {
          const btn = el.closest('button') || el.closest('a') || el.closest('[role="button"]') || el;
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            btn.click();
            return true;
          }
        }
      }
      return false;
    });

    if (!renewClicked) {
      const renewFallback = page.locator(':is(button, a, div, span):visible').filter({ hasText: /Renew now/i }).last();
      await renewFallback.waitFor({ state: 'visible', timeout: 10000 });
      await renewFallback.click({ force: true });
    }
    console.log('👉 已成功点击 [Renew now] 按钮！');

    // ⏳ 等待续期选择弹窗 ("Keep your server online") 彻底加载
    console.log('⏳ 等待续期选项弹窗加载...');
    await page.waitForSelector('text=/Keep your server online/i, text=/336 hours/i, text=/60 hours/i', { timeout: 15000 });
    await page.waitForTimeout(1500);

    // 🔍 检查第三个选项 [60 hours] 的状态 (是否处于不可选或冷却中)
    const option3Status = await page.evaluate(() => {
      const allNodes = Array.from(document.querySelectorAll('*'));
      const targetText = allNodes.find(el => {
        const txt = (el.textContent || '').trim();
        return /60\s*hours/i.test(txt) && el.children.length === 0;
      });

      if (!targetText) return { found: false, isLocked: true, reason: '未找到 60 hours 选项' };

      // 向上定位第三个选项的外层卡片容器
      let card = targetText;
      for (let i = 0; i < 5; i++) {
        if (card.parentElement && (
          card.parentElement.getAttribute('role') === 'button' ||
          card.parentElement.tagName === 'BUTTON' ||
          card.parentElement.className.includes('rounded')
        )) {
          card = card.parentElement;
          if (card.tagName === 'BUTTON' || card.getAttribute('role') === 'button') break;
        }
      }

      const cardText = (card.innerText || '').toLowerCase();
      const style = window.getComputedStyle(card);
      const isLocked = cardText.includes('come back later') ||
                       cardText.includes('before expiry') ||
                       card.hasAttribute('disabled') ||
                       card.getAttribute('aria-disabled') === 'true' ||
                       style.pointerEvents === 'none' ||
                       style.cursor === 'not-allowed' ||
                       card.className.includes('opacity-50') ||
                       card.className.includes('cursor-not-allowed');

      return {
        found: true,
        isLocked: isLocked,
        cardText: card.innerText
      };
    });

    console.log(`📋 第三个选项识别结果: 存在=${option3Status.found}, 是否锁定/不可选=${option3Status.isLocked}`);

    if (option3Status.isLocked) {
      const notTimeMsg = `⏳ <b>Freemchost 尚未到续期开放时间</b>\n\n第三个选项 (60 hours) 当前不可选（平台提示需在到期前开放或正处于冷却）。\n📌 当前服务器剩余时间: <b>${currentExpiryTime}</b>`;
      console.log('⚠️ ' + notTimeMsg.replace(/<[^>]+>/g, ''));
      await page.screenshot({ path: 'screenshots/renew_locked.png' });
      await sendTelegramMessage(tgToken, tgChatId, notTimeMsg);
      await browser.close();
      return;
    }

    // 🎯 可选状态：点击第三个选项进行续期
    console.log('👉 第三个选项可用，正在点击 [60 hours] 进行续期...');
    await page.evaluate(() => {
      const allNodes = Array.from(document.querySelectorAll('*'));
      const targetText = allNodes.find(el => /60\s*hours/i.test(el.textContent || '') && el.children.length === 0);
      if (targetText) {
        const btn = targetText.closest('button') || targetText.closest('[role="button"]') || targetText.closest('div[class*="rounded"]') || targetText;
        btn.click();
      }
    });

    // 检查是否有二级确认按钮（如 Confirm / Renew）
    const confirmBtn = page.locator('button:visible').filter({ hasText: /^(confirm|renew|continue)$/i }).first();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('👉 触发二级确认按钮...');
      await confirmBtn.click();
    }

    console.log('⏳ 等待平台处理续期请求并刷新数据...');
    await page.waitForTimeout(8000);

    // 确保弹窗关闭后重新抓取最新的倒计时数据
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1500);

    // 🕒 读取续期后的新剩余时间
    const updatedExpiryTime = await getExpiryTimeText(page);
    const afterHours = parseTimeToHours(updatedExpiryTime);
    console.log(`📌 续期后抓取的剩余时间: ${updatedExpiryTime} (约 ${afterHours} 小时)`);

    await page.screenshot({ path: 'screenshots/renew_result.png', fullPage: true });

    // 校验时间是否成功延长
    if (afterHours <= beforeHours || afterHours === 0) {
      throw new Error(`平台处理完毕后剩余时间未见增加 (原: ${currentExpiryTime}, 现: ${updatedExpiryTime})，可能点击未触发或需手动确认。`);
    }

    const successMsg = `🎉 <b>Freemchost 服务器已成功续期！</b>\n\n📌 续期前剩余时间: <b>${currentExpiryTime}</b>\n📌 续期后剩余时间: <b>${updatedExpiryTime}</b>`;
    console.log('✅ ' + successMsg.replace(/<[^>]+>/g, ''));
    await sendTelegramMessage(tgToken, tgChatId, successMsg);

  } catch (error) {
    console.error('❌ 执行过程中出错:', error.message);
    await page.screenshot({ path: 'screenshots/renew_error.png', fullPage: true });
    await sendTelegramMessage(tgToken, tgChatId, `⚠️ Freemchost 续期失败: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    console.log('🏁 浏览器已关闭，任务结束。');
  }
})();
