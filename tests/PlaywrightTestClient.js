const { test, expect } = require('@playwright/test');
const { axios } = require('axios');

class PlaywrightTestClient {

    serverUrl = 'http://localhost:8080/execute';
    httpClient = axios;

    async testWebNavigation() {
        const testSteps = 'Navigate to en.wikipedia.org. Search for India. Take a screenshot';
        const result = await this.sendTestSteps(testSteps);
        expect(result.passed).toBe(true, `Test failed: ${result.details}`);
    }

    async sendTestSteps(steps) {
        const testXpaths =
            '\n search box //input[@Type=\'search\']' +
            '\n search button xpath=//button[contains(@class, \'search\')]';

        const requestBody = {
            steps: steps,
            xpaths: testXpaths,
        };

        const response = await this.httpClient.post(this.serverUrl, requestBody, {
            headers: {
                'Content-Type': 'application/json',
            },
        });

        return response.data;
    }
}

test('test web navigation', async () => {
    const testSteps = 'Navigate to en.wikipedia.org. Search for India. Take a screenshot';
    const result = await this.sendTestSteps(testSteps);
    expect(result.passed).toBe(true, `Test failed: ${result.details}`);
});