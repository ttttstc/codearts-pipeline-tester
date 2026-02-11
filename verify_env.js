const fs = require('fs');
const path = require('path');

console.log('Current directory:', process.cwd());
console.log('Script path:', __filename);

try {
    console.log('Attempting to require playwright...');
    const { chromium } = require('playwright');
    console.log('✅ Playwright loaded successfully.');
    console.log('Chromium executable path:', chromium.executablePath());
} catch (e) {
    console.error('❌ Failed to require playwright:', e.message);
    console.error('Stack:', e.stack);
    console.error('Require paths:', module.paths);
}
