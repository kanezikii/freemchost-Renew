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

// 🛡️ 启动常驻弹窗监听：自动物理清除评分、反馈弹窗及遮罩，但保留续期选项弹窗
async function enableAutoPopupKiller(page) {
  await page.evaluate(() => {
    if (window.__popupKillerActive) return;
    window.__popupKillerActive = true;

    setInterval(() => {
      // 1. 查找并直接物理移除评分与建议弹窗
      document.querySelectorAll('*').forEach(el => {
        const txt = el.innerText || '';
        if (txt.includes('How would you rate') || txt.includes('Got an idea') || txt.includes('Your feedback')) {
          const modal = el.closest('[role="dialog"]') || el.closest('.fixed') || el;
          if (modal && !modal.innerText.includes('Keep your server online')) {
            try { modal.remove(); } catch (e) {}
          }
        }
      });

      // 2. 清理阻挡点击的背景遮罩（排除续期弹窗自身的容器）
      document.querySelectorAll('div.fixed.inset-0, div[class*="backdrop"]').forEach(backdrop => {
        if (!backdrop.innerText.includes('Keep your server online') && !backdrop.innerText.includes('336 hours')) {
          try { backdrop.remove(); } catch (e) {}
        }
      });

      // 恢复滚动与点击事件
      document.body.style.overflow = 'auto';
      document.body.style.pointerEvents = 'auto';
    }, 300);
  });
}

// 🕒 精准提取剩余时间 (如: 03天 19小时 42分钟)
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
    // 启用自动弹窗清除
    await enableAutoPopupKiller(page);

    // 检查并自动接受 Cookie
    const cookieBtn = page.locator('button').filter({ hasText: /^(accept all|reject all)$/i }).first();
    if (await cookieBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await cookieBtn.click({ force: true });
    }

    // 检查是否有配置更新卡片
    const updateOfferBtn = page.getByRole('button', { name: /Update to current offer/i }).first();
    if (await updateOfferBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('⚡ 检测到配置需要更新，正在点击 [Update to current offer]...');
      await updateOfferBtn.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2500);
    }

    console.log('📌 正在切换至 [PLAN / Billing] 选项卡...');
    const billingTabLocator = page.locator('button[role="tab"]').filter({ hasText: /billing/i }).first();
    await billingTabLocator.waitFor({ state: 'attached', timeout: 15000 });

    for (let retry = 1; retry <= 3; retry++) {
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

    // 🕒 获取续期前的当前时间
    const currentExpiryTime = await getExpiryTimeText(page);
    const beforeHours = parseTimeToHours(currentExpiryTime);
    console.log(`📌 抓取到的当前服务器剩余时间: ${currentExpiryTime} (约 ${beforeHours} 小时)`);

    // 🔄 点击红色 [Renew now] 按钮
    console.log('🔄 正在寻找并点击红色 [Renew now] 按钮...');
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button, a, [role="button"], div, span'));
      for (const el of all) {
        if (/renew now/i.test((el.innerText || '').trim())) {
          const btn = el.closest('button') || el.closest('[role="button"]') || el;
          btn.scrollIntoView();
          btn.click();
          return;
        }
      }
    });

    // 兜底再次触发点击
    const renewFallback = page.locator(':is(button, [role="button"], a):visible').filter({ hasText: /Renew now/i }).last();
    if (await renewFallback.isVisible({ timeout: 2000 }).catch(() => false)) {
      await renewFallback.click({ force: true });
    }
    console.log('👉 已触发 [Renew now] 点击事件！');

    // ⏳ 等待续期选项弹窗 ("Keep your server online") 渲染完成
    console.log('⏳ 等待续期选项弹窗加载...');
    await page.waitForFunction(() => {
      const txt = document.body.innerText || '';
      return txt.includes('Keep your server online') || txt.includes('60 hours') || txt.includes('336 hours');
    }, { timeout: 15000 });
    await page.waitForTimeout(1500);

    // 🔍 检查第三个选项 [60 hours] 的可选状态
    const option3Status = await page.evaluate(() => {
      const allNodes = Array.from(document.querySelectorAll('*'));
      const hours60 = allNodes.find(el => {
        const txt = (el.textContent || '').trim();
        return /60\s*hours/i.test(txt) && el.children.length === 0;
      });

      if (!hours60) return { found: false, isLocked: true, reason: '未找到 60 hours 选项' };

      // 向上寻找第三个选项的外层卡片
      let card = hours60;
      for (let i = 0; i < 6; i++) {
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

      // 判断是否包含冷却/锁定提示或不可交互样式
      const isLocked = cardText.includes('come back later') ||
                       cardText.includes('before expiry') ||
                       card.hasAttribute('disabled') ||
                       card.getAttribute('aria-disabled') === 'true' ||
                       style.pointerEvents === 'none' ||
                       style.cursor === 'not-allowed' ||
                       card.className.includes('cursor-not-allowed') ||
                       card.className.includes('opacity-50');

      return {
        found: true,
        isLocked: isLocked,
        cardText: card.innerText
      };
    });

    console.log(`📋 第三个选项 [60 hours] 状态: 找到=${option3Status.found}, 是否锁定/不可选=${option3Status.isLocked}`);

    // ⚠️ 如果当前仍处于锁定/不可选状态（如剩余时间多于 46 小时），正常退出并汇报
    if (option3Status.isLocked) {
      const notTimeMsg = `⏳ <b>Freemchost 尚未到续期开放时间</b>\n\n📌 当前服务器剩余时间: <b>${currentExpiryTime}</b>\n💡 第三个选项 (60 hours) 当前不可选（需在到期前 46 小时内开放）。脚本将按定时任务持续自动检测。`;
      console.log('⚠️️ ' + notTimeMsg.replace(/<[^>]+>/g, ''));
      await page.screenshot({ path: 'screenshots/renew_locked.png' });
      await sendTelegramMessage(tgToken, tgChatId, notTimeMsg);
      await browser.close();
      return; // 正常退出，Exit 0，不触发 GitHub Action 报红
    }

    // 🎯 可以续期状态：点击第三个选项
    console.log('🎉 检测到第三个选项已开放！正在点击 [60 hours] 续期...');
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const hours60 = all.find(el => (el.textContent || '').trim().toLowerCase() === '60 hours' || ((el.textContent || '').includes('60 hours') && el.children.length === 0));
      if (hours60) {
        const btn = hours60.closest('button') || hours60.closest('[role="button"]') || hours60.closest('div[class*="rounded"]') || hours60;
        btn.click();
      }
    });

    // 检查是否有二级确认按钮（如 Confirm / Renew）
    const confirmBtn = page.locator('button:visible').filter({ hasText: /^(confirm|renew|continue)$/i }).first();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('👉 触发二级确认按钮...');
      await confirmBtn.click();
    }

    console.log('⏳ 等待平台完成续期操作...');
    await page.waitForTimeout(6000);

    // 刷新页面以确保获取最新的数据库倒计时
    console.log('🔄 正在刷新页面读取最新剩余时间...');
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await enableAutoPopupKiller(page);

    // 重新切到 Billing 选项卡
    const tabAgain = page.locator('button[role="tab"]').filter({ hasText: /billing/i }).first();
    await tabAgain.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2000);

    // 🕒 读取续期后的新剩余时间
    const updatedExpiryTime = await getExpiryTimeText(page);
    const afterHours = parseTimeToHours(updatedExpiryTime);
    console.log(`📌 续期后抓取的剩余时间: ${updatedExpiryTime} (约 ${afterHours} 小时)`);

    await page.screenshot({ path: 'screenshots/renew_result.png', fullPage: true });

    // 校验剩余时间是否延长
    if (afterHours <= beforeHours && afterHours !== 0) {
      throw new Error(`续期请求已提交，但剩余时间未发生变化 (仍为: ${updatedExpiryTime})，可能平台延迟或存在风控。`);
    }

    const successMsg = `🎉 <b>Freemchost 服务器已成功续期！</b>\n\n📌 续期前剩余时间: <b>${currentExpiryTime}</b>\n📌 续期后最新时间: <b>${updatedExpiryTime}</b>`;
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
