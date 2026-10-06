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

// 🛡️ 出现弹窗时点击 [×] 或跳过/接受按钮
async function dismissPopupsIfPresent(page) {
  try {
    await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('button, svg, span, div, a'));
      allElements.forEach(el => {
        const txt = (el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        if (txt === '×' || txt === '✕' || txt === 'x' || aria.includes('close')) {
          try { el.click(); } catch(e) {}
        }
      });

      const actionBtns = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
      actionBtns.forEach(el => {
        const txt = (el.textContent || '').trim().toLowerCase();
        if (['maybe later', 'close', 'reject all', 'accept all'].includes(txt)) {
          try { el.click(); } catch(e) {}
        }
      });
    });
  } catch (e) {}
  await page.waitForTimeout(500);
}

// 🕒 精准提取剩余时间 (如: 01天 16小时 30分钟)
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

// 🧮 将时间字符串转换为总小时数，用于严格的数学校验
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
    await dismissPopupsIfPresent(page);

    console.log('📌 正在点击 [PLAN / Billing] 选项卡...');
    const billingTab = page.getByText('Billing', { exact: false }).first();
    await billingTab.waitFor({ state: 'visible', timeout: 15000 });
    await billingTab.click();
    await page.waitForTimeout(1500);

    await dismissPopupsIfPresent(page);

    // 🕒 获取并计算续期前的时间
    const currentExpiryTime = await getExpiryTimeText(page);
    const beforeHours = parseTimeToHours(currentExpiryTime);
    console.log(`📌 抓取到的当前服务器剩余时间: ${currentExpiryTime} (约 ${beforeHours} 小时)`);

    // 检测是否根本还没到开放续期时间
    const isLocked = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return txt.includes('46h before expiry') || txt.includes('come back later');
    });

    if (isLocked) {
      const notTimeMsg = `⏳ <b>Freemchost 尚未到续期时间</b>\n\n必须在到期前 46 小时内开放免费续期。\n📌 当前服务器剩余时间: <b>${currentExpiryTime}</b>`;
      console.log('⚠️ ' + notTimeMsg.replace(/<[^>]+>/g, ''));
      await sendTelegramMessage(tgToken, tgChatId, notTimeMsg);
      await browser.close();
      return;
    }

    console.log('🔄 正在寻找并点击红色 [Renew now] 按钮...');
    const renewBtn = page.getByText('Renew now', { exact: false }).first();
    await renewBtn.waitFor({ state: 'visible', timeout: 15000 });
    await renewBtn.click({ force: true });
    console.log('👉 已点击 [Renew now] 按钮！');

    await page.waitForTimeout(3000); // 必须等待弹窗彻底加载

    console.log('📋 正在寻找并强制点击 [60 hours] 续期选项...');
    const hours60Option = page.locator('text=/60 hours/i').first();
    await hours60Option.waitFor({ state: 'visible', timeout: 10000 });
    
    // 强制使用原生 JS 向上查找到真正的 Button 进行点击，避免被透明层拦截
    await hours60Option.evaluate(el => {
      const btn = el.closest('button') || el.closest('div[role="button"]') || el;
      btn.click();
    });
    console.log('👉 已触发 [60 hours] 点击事件！');

    // 等待足够长的时间让 API 请求发送且前端 DOM 刷新
    console.log('⏳ 等待平台处理续期请求...');
    await page.waitForTimeout(8000); 

    // 🕒 重新获取并严格校验时间
    const updatedExpiryTime = await getExpiryTimeText(page);
    const afterHours = parseTimeToHours(updatedExpiryTime);
    console.log(`📌 再次抓取服务器剩余时间: ${updatedExpiryTime} (约 ${afterHours} 小时)`);

    await page.screenshot({ path: 'screenshots/renew_result.png', fullPage: true });

    // 严格判断：如果续期后的总小时数没有增加（或者等于0），判定为失败
    if (afterHours <= beforeHours || afterHours === 0) {
      throw new Error(`平台未响应续期请求，剩余时间未发生改变 (仍为 ${updatedExpiryTime})。可能按钮点击未生效或存在风控。`);
    }

    const successMsg = `🎉 <b>Freemchost 服务器已成功续期！</b>\n\n📌 续期后剩余时间: <b>${updatedExpiryTime}</b>`;
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
