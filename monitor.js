console.log("🟢 MONITOR DE CITAS INICIADO");
console.log("✅ El sistema puede ejecutar JavaScript correctamente.");
console.log("⏱️ Prueba inicial completada.");
const { chromium } = require('playwright');

(async () => {
  console.log("🌐 Iniciando prueba de Playwright...");

  const browser = await chromium.launch({
    headless: false
  });

  const page = await browser.newPage();

  await page.goto('https://www.google.com');

  console.log("✅ Playwright funciona correctamente.");
  console.log("📄 Título:", await page.title());

  await page.waitForTimeout(5000);

  await browser.close();

  console.log("🔴 Prueba de Playwright finalizada.");
})();
