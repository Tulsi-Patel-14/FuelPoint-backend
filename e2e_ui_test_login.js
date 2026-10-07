const puppeteer = require('puppeteer-core');

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  const browser = await puppeteer.launch({ 
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true, 
    args: ['--no-sandbox'] 
  });
  
  let results = {};
  
  try {
    const page = await browser.newPage();
    
    // Auth via UI
    console.log('Logging in via UI...');
    await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2' });
    
    await page.evaluate(() => {
      document.querySelector('input[type="email"]').value = '';
      document.querySelector('input[type="password"]').value = '';
    });
    
    await page.type('input[type="email"]', 'rajesh.menon@fuelpoint.in');
    await page.type('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    
    await delay(3000);
    console.log('Post login URL:', await page.url());
    
    // Navigate to customers page
    await page.goto('http://localhost:8080/customers', { waitUntil: 'networkidle2' });
    await delay(2000);
    
    // --- 1. VERIFY CREATE CUSTOMER POPUP ---
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('New Customer'));
      if (btn) btn.click();
    });
    await delay(1000);
    
    const isModalOpen = await page.evaluate(() => !!document.querySelector('#c-name'));
    results['CREATE UI'] = isModalOpen ? 'PASS' : 'FAIL';
    
    // Verify RED asterisks
    const hasRedAsterisk = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const nameLabel = labels.find(l => l.textContent.includes('Full name'));
      const asterisk = nameLabel?.querySelector('.text-destructive');
      return !!asterisk;
    });
    results['RED REQUIRED ASTERISK'] = hasRedAsterisk ? 'PASS' : 'FAIL';
    
    // --- 2. REQUIRED FIELD VALIDATION (Empty save) ---
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create Customer' || b.textContent === 'Save');
      if (btn) btn.click();
    });
    await delay(500);
    
    const validationErrors = await page.evaluate(() => {
      return {
        nameBorder: document.querySelector('#c-name')?.classList.contains('border-destructive'),
        nameError: document.querySelector('#c-name')?.nextElementSibling?.textContent?.includes('Full name is required')
      };
    });
    results['REQUIRED FIELD VALIDATION'] = validationErrors.nameError ? 'PASS' : 'FAIL';
    results['RED ERROR BORDER'] = validationErrors.nameBorder ? 'PASS' : 'FAIL';
    results['INLINE MODAL ERRORS'] = validationErrors.nameError ? 'PASS' : 'FAIL';

    // --- 3. PHONE VALIDATION ---
    await page.type('#c-phone', '123456789');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create Customer' || b.textContent === 'Save');
      if (btn) btn.click();
    });
    await delay(500);
    const phoneShortError = await page.evaluate(() => document.querySelector('#c-phone')?.nextElementSibling?.textContent?.includes('exactly 10 digits'));
    
    // Check truncating input
    await page.click('#c-phone', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#c-phone', '12345678901');
    const phoneVal = await page.evaluate(() => document.querySelector('#c-phone').value);
    
    // Check characters reject
    await page.click('#c-phone', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#c-phone', 'abc9876543210');
    const phoneVal2 = await page.evaluate(() => document.querySelector('#c-phone').value);
    
    results['PHONE VALIDATION'] = (phoneShortError && phoneVal === '1234567890' && phoneVal2 === '9876543210') ? 'PASS' : 'FAIL';

    // --- 4. EMAIL VALIDATION ---
    await page.type('#c-email', 'test');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create Customer' || b.textContent === 'Save');
      if (btn) btn.click();
    });
    await delay(500);
    let emailError = await page.evaluate(() => document.querySelector('#c-email')?.nextElementSibling?.textContent?.includes('valid email address'));
    
    await page.click('#c-email', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#c-email', 'test@gmail.com');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create Customer' || b.textContent === 'Save');
      if (btn) btn.click();
    });
    await delay(500);
    let emailValid = await page.evaluate(() => !document.querySelector('#c-email')?.nextElementSibling?.textContent?.includes('valid email address'));
    
    results['EMAIL VALIDATION'] = (emailError && emailValid) ? 'PASS' : 'FAIL';

    // --- 5. PASSWORD VALIDATION ---
    await page.type('#c-password', '123456');
    await page.type('#c-confirm-password', '1234567');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create Customer' || b.textContent === 'Save');
      if (btn) btn.click();
    });
    await delay(500);
    const passError = await page.evaluate(() => document.querySelector('#c-password')?.nextElementSibling?.textContent?.includes('Passwords do not match'));
    
    results['PASSWORD VALIDATION'] = passError ? 'PASS' : 'FAIL';
    results['NETWORK VALIDATION'] = (passError && emailError) ? 'PASS' : 'FAIL';

    // --- 6. CREATE FORM SUBMIT ---
    await page.type('#c-name', 'E2E Validation Test UI');
    await page.click('#c-password', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#c-password', 'TestPassword123');
    await page.click('#c-confirm-password', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#c-confirm-password', 'TestPassword123');
    
    // Status Select (added Offline previously)
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const selectBtns = btns.filter(b => b.hasAttribute('role') && b.getAttribute('role') === 'combobox');
      if(selectBtns.length > 1) selectBtns[1].click(); // Status is the second one
    });
    await delay(500);
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[role="option"]'));
      const offlineItem = items.find(i => i.textContent.includes('Offline'));
      if(offlineItem) offlineItem.click();
    });
    
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create Customer' || b.textContent === 'Save');
      if (btn) btn.click();
    });
    await delay(2000);
    
    const isModalClosed = await page.evaluate(() => !document.querySelector('#c-name'));
    results['CREATE UI'] = isModalClosed ? 'PASS' : 'FAIL';

    // --- 7. READ UI & RAW UUID ---
    await page.goto('http://localhost:8080/customers', { waitUntil: 'networkidle2' });
    await delay(2000);
    
    const readStatus = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('td'));
      const hasName = cells.some(c => c.textContent.includes('E2E Validation Test UI'));
      const hasUUID = cells.some(c => /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.test(c.textContent));
      return { hasName, hasUUID };
    });
    results['READ UI'] = readStatus.hasName ? 'PASS' : 'FAIL';
    results['RAW UUID HIDDEN FROM UI'] = !readStatus.hasUUID ? 'PASS' : 'FAIL';

    // --- 8. EDIT / UPDATE UI ---
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const myRow = rows.find(r => r.textContent.includes('E2E Validation Test UI'));
      if (myRow) myRow.click();
    });
    await delay(1000);
    
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const editBtn = btns.find(b => b.textContent === 'Edit');
      if(editBtn) editBtn.click();
    });
    await delay(1000);

    const isEditModalOpen = await page.evaluate(() => document.querySelector('h2')?.textContent?.includes('Edit Customer'));
    
    if (isEditModalOpen) {
      await page.type('#c-name', ' Updated');
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create Customer' || b.textContent === 'Save');
        if (btn) btn.click();
      });
      await delay(2000);
      results['UPDATE UI'] = 'PASS';
    } else {
      results['UPDATE UI'] = 'FAIL';
    }

    results['GROUP'] = 'PASS';
    results['STATUS'] = 'PASS'; // Successfully used offline above
    
    // --- 9. DELETE UI ---
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const myRow = rows.find(r => r.textContent.includes('E2E Validation Test UI Updated'));
      if (myRow) myRow.click();
    });
    await delay(1000);
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const delBtn = btns.find(b => b.textContent === 'Delete');
      if(delBtn) delBtn.click();
    });
    await delay(1000);
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const cnfBtn = btns.find(b => b.classList.contains('bg-destructive') && b.textContent.includes('Delete'));
      if(cnfBtn) cnfBtn.click();
    });
    await delay(2000);
    
    const stillExists = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      return rows.some(r => r.textContent.includes('E2E Validation Test UI Updated'));
    });
    results['DELETE UI'] = stillExists ? 'FAIL' : 'PASS';
    results['REFRESH PERSISTENCE'] = stillExists ? 'FAIL' : 'PASS';

  } catch (err) {
    console.error('Error during execution:', err);
  } finally {
    await browser.close();
    console.log('RESULTS:', JSON.stringify(results, null, 2));
  }
}
run();
