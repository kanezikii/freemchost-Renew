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

// 🛡️ 温和关闭评分与 Cookie 弹窗（使用 React 原生事件，杜绝 DOM 强删崩溃）
async function safelyDismissUnwantedPopups(page) {
  try {
    // 1. 发送 Escape 原生快捷键关闭对话框
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);

    // 2. 如果出现评分/反馈弹窗，点击 Maybe later
    const maybeLater = page.locator(':is(button, a, div[role="button"]):visible').filter({ hasText: /^maybe later$/i }).first();
    if (await maybeLater.isVisible({ timeout: 600 }).catch(() => false)) {
      await maybeLater.click({ force: true });
      await page.waitForTimeout(500);
    }

    // 3. 处理 Cookie 横幅
    const cookieBtn = page.locator('button:visible').filter({ hasText: /^(accept all|reject all)$/i }).first();
    if (await cookieBtn.isVisible({ timeout: 600 }).catch(() => false)) {
      await cookieBtn.click({ force: true });
      await page.waitForTimeout(300);
    }
  } catch (e) {}
}

// 🕒 精准提取剩余时间 (如: 03天 19小时 37分钟)
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

    await page.waitForTimeout(2000);
    await safelyDismissUnwantedPopups(page);

    // 检查是否有配置更新卡片 (Offer update)
    const updateOfferBtn = page.getByRole('button', { name: /Update to current offer/i }).first();
    if (await updateOfferBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('⚡ 检测到配置需要更新，正在点击 [Update to current offer]...');
      await updateOfferBtn.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2500);
      await safelyDismissUnwantedPopups(page);
    }

    console.log('📌 正在切换至 [PLAN / Billing] 选项卡...');
    const billingTabLocator = page.locator('button[role="tab"]').filter({ hasText: /billing/i }).first();
    await billingTabLocator.waitFor({ state: 'attached', timeout: 15000 });

    for (let retry = 1; retry <= 3; retry++) {
      await safelyDismissUnwantedPopups(page);
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
    await safelyDismissUnwantedPopups(page);

    // 🕒 获取续期前的当前时间
    const currentExpiryTime = await getExpiryTimeText(page);
    const beforeHours = parseTimeToHours(currentExpiryTime);
    console.log(`📌 抓取到的当前服务器剩余时间: ${currentExpiryTime} (约 ${beforeHours} 小时)`);

    // 🔄 点击红色 [Renew now] 按钮
    console.log('🔄 正在点击红色 [Renew now] 按钮...');
    const renewBtn = page.locator('button').filter({ hasText: /Renew now/i }).first();
    await renewBtn.waitFor({ state: 'visible', timeout: 10000 });
    await renewBtn.scrollIntoViewIfNeeded();
    await renewBtn.click({ force: true });
    console.log('👉 已点击 [Renew now] 按钮！');

    // ⏳ 等待续期选项弹窗 ("Keep your server online") 打开
    console.log('⏳ 等待续期选项弹窗加载...');
    const renewDialog = page.locator('[role="dialog"]').filter({ hasText: /Keep your server online/i });
    await renewDialog.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1000);

    // 🔍 检查弹窗中的第三个选项（60 hours）状态
    const modalContent = await renewDialog.innerText();
    const isOptionLocked = modalContent.includes('come back later') || modalContent.includes('46h before expiry');

    console.log(`📋 第三个选项 [60 hours] 状态: 是否受限/不可选=${isOptionLocked}`);

    // ⚠️ 如果当前未开放续期（仍处于冷却/未到 46 小时窗口）
    if (isOptionLocked) {
      const notTimeMsg = `💗主人，未到续期时间，无须续期。\n\n⏳ <b>Freemchost 状态提醒</b>\n━━━━━━━━━━━━━━━\n📌 <b>当前剩余时间：</b>${currentExpiryTime}\n💡 <b>规则提示：</b>免费 60 hours 需在到期前 46 小时内开放\n🤖 <b>巡检状态：</b>锁定保护中，定时任务持续自动监测`;
      
      console.log('ℹ️ ' + notTimeMsg.replace(/<[^>]+>/g, ''));
      await page.screenshot({ path: 'screenshots/renew_locked.png' });
      await sendTelegramMessage(tgToken, tgChatId, notTimeMsg);

      // 关闭弹窗并优雅结束
      await page.keyboard.press('Escape').catch(() => {});
      await browser.close();
      console.log('🏁 任务正常结束（未到期无需操作）。');
      return; // Exit code 0，不报错
    }

    // 🎯 已到开放时间：点击第三个选项 [60 hours]
    console.log('🎉 检测到第三个选项已开放！正在点击 [60 hours] 进行续期...');
    const option60Card = renewDialog.locator('*').filter({ hasText: /60\s*hours/i }).last();
    await option60Card.click({ force: true });

    // 检查是否有确认按钮
    const confirmBtn = renewDialog.locator('button').filter({ hasText: /^(confirm|renew|continue)$/i }).first();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('👉 触发确认按钮...');
      await confirmBtn.click();
    }

    console.log('⏳ 等待平台处理续期请求...');
    await page.waitForTimeout(6000);

    // 刷新页面重新读取最新剩余时间
    console.log('🔄 正在刷新页面读取最新剩余时间...');
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await safelyDismissUnwantedPopups(page);

    // 重新切到 Billing 标签读取时间
    const billingTabAgain = page.locator('button[role="tab"]').filter({ hasText: /billing/i }).first();
    await billingTabAgain.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2000);

    // 🕒 读取续期后的新剩余时间
    const updatedExpiryTime = await getExpiryTimeText(page);
    const afterHours = parseTimeToHours(updatedExpiryTime);
    console.log(`📌 续期后抓取的剩余时间: ${updatedExpiryTime} (约 ${afterHours} 小时)`);

    await page.screenshot({ path: 'screenshots/renew_result.png', fullPage: true });

    // 校验续期是否生效
    if (afterHours <= beforeHours && afterHours !== 0) {
      throw new Error(`续期操作已执行，但剩余时间未增加 (仍为: ${updatedExpiryTime})。可能存在风控或平台延迟。`);
    }

    // 续期成功消息
    const successMsg = `🎉 <b>💗主人，Freemchost 服务器续期成功！</b>\n\n━━━━━━━━━━━━━━━\n📌 <b>续期前剩余时间：</b>${currentExpiryTime}\n✨ <b>续期后剩余时间：</b>${updatedExpiryTime}\n━━━━━━━━━━━━━━━\n💗 服务器已成功延期，请主人放心使用！`;
    
    console.log('✅ ' + successMsg.replace(/<[^>]+>/g, ''));
    await sendTelegramMessage(tgToken, tgChatId, successMsg);

  } catch (error) {
    console.error('❌ 执行过程中出错:', error.message);
    await page.screenshot({ path: 'screenshots/renew_error.png', fullPage: true });
    
    const errorMsg = `⚠️ <b>Freemchost 续期任务异常</b>\n\n━━━━━━━━━━━━━━━\n❌ <b>失败原因：</b><code>${error.message}</code>\n📌 请主人检查 GitHub Actions 截图排查。`;
    await sendTelegramMessage(tgToken, tgChatId, errorMsg);
    process.exitCode = 1;
  } finally {
    await browser.close();
    console.log('🏁 浏览器已关闭，任务结束。');
  }
})();
