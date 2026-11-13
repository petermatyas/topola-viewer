import {expect, test} from '@playwright/test';
import {setupHermeticEnvironment} from './helpers';

test.describe('Map view', () => {
  test.beforeEach(async ({page, context}) => {
    await setupHermeticEnvironment(context);
    // Serve empty map tiles instead of downloading them from OpenStreetMap.
    await context.route(
      /(openstreetmap\.(org|fr|de)|opentopomap\.org)\/.*\.png$/,
      (route) => route.fulfill({status: 204}),
    );
    await page.goto('/');
    await page.setInputFiles('#fileInput', 'src/datasource/testdata/map.ged');
    await expect(page).toHaveURL(/.*\/view.*/);
    await page.evaluate(() => {
      location.hash = location.hash + '&view=map&indi=I6';
    });
  });

  test('shows the chart next to the map', async ({page}) => {
    await expect(page.getByTestId('map-split')).toBeVisible();
    await expect(page.locator('#content #chart')).toContainText('Flora');
    await expect(page.getByTestId('map-filter-bar')).toBeVisible();
    await expect(page.locator('.map-marker.selected')).toHaveCount(1);
    // Ancestor lines are drawn by default.
    await expect(page.locator('.leaflet-overlay-pane path')).not.toHaveCount(0);
  });

  test('selects a person from a marker popup', async ({page}) => {
    await page.locator('.map-marker.selected').click();
    const popup = page.locator('.map-popup');
    await expect(popup).toContainText('Hegyvaros');
    await popup.getByText('Anna Kovacs').click();
    await expect(page).toHaveURL(/indi=I1/);
  });

  test('lists places without coordinates', async ({page}) => {
    await page.getByTestId('map-missing').getByRole('button').first().click();
    await expect(page.locator('.map-missing-panel')).toContainText('Faluvég');
  });

  test('stores filters in the URL', async ({page}) => {
    await page.locator('.map-movements').click();
    await page.locator('.map-movements .item', {hasText: 'No lines'}).click();
    await expect(page).toHaveURL(/mmove=off/);
    await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(0);
  });
});
