import { expect, test, type Page } from '@playwright/test';
import { installFakeTauri } from './fakeTauri';

test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
test.setTimeout(90_000);

const activity = (page: Page, name: RegExp | string) => page.locator('.activity').getByRole('button', { name });

test.describe('information architecture', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeTauri(page);
    await page.goto('/');
  });

  test('first screen explains what to do: four step cards, folder first', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Open iOS Studio', level: 1 })).toBeVisible();
    const cards = page.locator('.wl-card');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toContainText('Proje aç');
    await expect(cards.nth(0)).toContainText('Yapılacak');
    await expect(cards.nth(0).getByRole('button', { name: 'Klasör aç' })).toHaveClass(/primary/);
    await expect(cards.nth(1)).toContainText('Yapay zekâyı bağla');
    await expect(cards.nth(2)).toContainText('xtool');
    await expect(cards.nth(3)).toContainText('Üret, derle, yükle');
  });

  test('the next step becomes the primary action after a folder is opened', async ({ page }) => {
    await page.getByRole('button', { name: 'Klasör aç' }).first().click();
    await expect(page.getByRole('tree')).toBeVisible();
    await expect(page.locator('.wl-card').nth(0)).toContainText('Hazır');
    await expect(page.locator('.wl-card').nth(1).getByRole('button')).toHaveClass(/primary/);
  });

  test('the side panel shows one module at a time', async ({ page }) => {
    await page.getByRole('button', { name: 'Klasör aç' }).first().click();
    await expect(page.getByRole('tree')).toBeVisible();

    await activity(page, /^Derle/).click();
    await expect(page.getByRole('button', { name: 'Derle ve Yükle' })).toBeVisible();
    await expect(page.getByRole('tree')).toHaveCount(0);

    await activity(page, /^Cihazlar/).click();
    await expect(page.getByRole('region', { name: 'Cihazlar paneli' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Derle ve Yükle' })).toHaveCount(0);

    await activity(page, /^Yapay zekâ/).click();
    await expect(page.getByLabel('Sağlayıcı')).toBeVisible();

    await activity(page, /^Dosyalar/).click();
    await expect(page.getByRole('tree')).toBeVisible();
  });

  test('Derle ve Yükle explains why it is disabled instead of failing', async ({ page }) => {
    await page.getByRole('button', { name: 'Klasör aç' }).first().click();
    await activity(page, /^Derle/).click();
    const install = page.getByRole('button', { name: 'Derle ve Yükle' });
    await expect(install).toBeDisabled();
    await expect(page.locator('.bs-why')).toContainText(/xtool bulunamadı|iPhone/);
    await expect(page.locator('.bs-summary').getByText('Bulunamadı', { exact: true })).toBeVisible();
  });

  test('the AI chat panel is closed by default and opens on demand', async ({ page }) => {
    await expect(page.getByRole('complementary', { name: 'Yapay zekâ asistanı' })).toHaveCount(0);
    await activity(page, /^Yapay zekâ/).click();
    const chat = page.getByRole('complementary', { name: 'Yapay zekâ asistanı' });
    await expect(chat).toBeVisible();
    // The chat is only conversation: no provider/model/key form in the right panel.
    await expect(chat.getByLabel('Sağlayıcı')).toHaveCount(0);
    await expect(chat.getByRole('button', { name: 'Dosya üret' })).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Önce plan' })).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Sor', exact: true })).toBeVisible();
    await chat.getByRole('button', { name: 'Yapay zekâ panelini kapat' }).click();
    await expect(chat).toHaveCount(0);
  });

  test('AI settings keep the technical notes collapsed', async ({ page }) => {
    await activity(page, /^Yapay zekâ/).click();
    const info = page.locator('details.ai-info').filter({ hasText: 'nasıl bağlanırım' });
    await expect(info).toBeVisible();
    await expect(info).not.toHaveAttribute('open', '');
  });

  test('status bar summarises project, tools, device, AI and problems', async ({ page }) => {
    const bar = page.getByRole('contentinfo', { name: 'Durum çubuğu' });
    await expect(bar).toContainText('Klasör açık değil');
    await expect(bar).toContainText('xtool');
    await expect(bar).toContainText('Swift');
    await expect(bar).toContainText('iPhone bağlı değil');
    await expect(bar).toContainText('0 hata');
    await expect(bar).toContainText('0 uyarı');
    await page.getByRole('button', { name: 'Klasör aç' }).first().click();
    await expect(bar).toContainText('demo');
  });

  test('the bottom panel offers Çıktı, Sorunlar and Terminal as tabs', async ({ page }) => {
    await activity(page, /^Terminal/).click();
    await page.getByRole('button', { name: /hata/ }).click();
    for (const name of [/Çıktı/, /Sorunlar/, /Terminal/]) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }
    await expect(page.getByText('Bildirilen sorun yok')).toBeVisible();
    await page.getByRole('tab', { name: /Çıktı/ }).click();
    await expect(page.getByText(/Henüz çıktı yok/)).toBeVisible();
  });

  test('errors are slim dismissible notices, not a full-width red band', async ({ page }) => {
    await page.getByRole('button', { name: 'Klasör aç' }).first().click();
    await page.getByRole('button', { name: 'Yeni dosya' }).first().click();
    await page.getByLabel('Yeni dosya yolu').fill('Package.swift');
    await page.keyboard.press('Enter');
    const notice = page.locator('.notice[role="alert"]');
    await expect(notice).toBeVisible();
    const box = (await notice.boundingBox())!;
    const region = (await page.locator('.editor-region').boundingBox())!;
    expect(box.width).toBeLessThan(region.width - 16);
    await notice.getByRole('button', { name: 'Kapat' }).click();
    await expect(notice).toHaveCount(0);
  });
});
