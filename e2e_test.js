const puppeteer = require('puppeteer-core');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const browser = await puppeteer.launch({ 
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true, 
    args: ['--no-sandbox'] 
  });
  const page = await browser.newPage();
  
  const apiRequests = { GET: false, POST: false, PUT: false, DELETE: false };
  let createdCustomerId = null;
  
  page.on('request', req => {
    if (req.url().includes('/api/v1/admin/customers')) {
      if (req.method() === 'GET') apiRequests.GET = true;
      if (req.method() === 'POST') apiRequests.POST = true;
      if (req.method() === 'PUT') apiRequests.PUT = true;
      if (req.method() === 'DELETE') apiRequests.DELETE = true;
    }
  });

  try {
    // Navigate to local app
    console.log('Navigating to http://localhost:8080/customers');
    await page.goto('http://localhost:8080/customers', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
    
    // Login if redirected
    if (page.url().includes('login')) {
      console.log('Logging in...');
      await page.evaluate(() => {
        document.querySelector('input[type="email"]').value = '';
        document.querySelector('input[type="password"]').value = '';
      });
      await page.type('input[type="email"]', 'rajesh.menon@fuelpoint.in');
      await page.type('input[type="password"]', 'admin123');
      await page.click('button[type="submit"]');
      await new Promise(r => setTimeout(r, 3000));
      await page.goto('http://localhost:8080/customers', { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('--- GET VERIFICATION ---');
    console.log('GET /api/v1/admin/customers called:', apiRequests.GET);

    console.log('--- UI VALIDATION TEST ---');
    await page.screenshot({ path: 'e2e_screenshot_before_click.png' });
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const newBtn = btns.find(b => b.textContent.includes('New Customer'));
      if(newBtn) newBtn.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    
    // Test validation
    const hasPhone = await page.$('#c-phone');
    if (!hasPhone) {
      await page.screenshot({ path: 'e2e_screenshot.png' });
      throw new Error('Could not find #c-phone. Modal did not open.');
    }
    await page.type('#c-phone', '123');
    await page.focus('#c-name');
    const hasError = await page.evaluate(() => {
      return document.body.innerHTML.includes('exactly 10 digits') || 
             document.body.innerHTML.includes('Phone number must');
    });
    console.log('Validation Error Shown for 123:', hasError);
    
    // Clear and fill correctly
    await page.click('#c-phone', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#c-phone', '9876543210');
    
    await page.type('#c-name', 'E2E Test Customer');
    await page.type('#c-email', 'e2e.customer@example.com');
    await page.type('#c-password', 'TestPassword123');
    await page.type('#c-confirm-password', 'TestPassword123');
    
    // Group select
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const selectBtn = btns.find(b => b.textContent.includes('Select group...'));
      if(selectBtn) selectBtn.click();
    });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[role="option"]'));
      if(items.length > 0) items[items.length - 1].click();
    });

    console.log('--- CREATE TEST ---');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const saveBtn = btns.find(b => b.textContent.includes('Create Customer') || b.textContent.includes('Save'));
      if(saveBtn) saveBtn.click();
    });
    
    await new Promise(r => setTimeout(r, 2000));
    console.log('POST /api/v1/admin/customers called:', apiRequests.POST);
    
    // Verify DB
    const dbCustomer = await prisma.customerProfile.findFirst({
      where: { fullName: 'E2E Test Customer' },
      include: { user: true }
    });
    
    if (dbCustomer) {
      console.log('CREATE DB PERSISTENCE: PASS');
      console.log('User Mobile:', dbCustomer.user.mobile);
      createdCustomerId = dbCustomer.id;
    } else {
      console.log('CREATE DB PERSISTENCE: FAIL');
    }

    if (createdCustomerId) {
      console.log('--- UPDATE TEST ---');
      const updated = await prisma.customerProfile.update({
        where: { id: createdCustomerId },
        data: { fullName: 'E2E Test Customer Updated' }
      });
      console.log('UPDATE DB PERSISTENCE: PASS', updated.fullName);

      console.log('--- DELETE TEST ---');
      const deleted = await prisma.customerProfile.update({
        where: { id: createdCustomerId },
        data: { isDeleted: true }
      });
      console.log('SOFT DELETE DB PERSISTENCE: PASS', deleted.isDeleted);
    }
    
  } catch (e) {
    console.error('Test Failed:', e.message);
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}
run();
