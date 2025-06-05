const { test, expect } = require('@playwright/test');
const axios = require('axios');

async function sendTestSteps(steps) {
    const testXpaths =
        "\nsearch box //input[@Type='search']" +
        '\nsearch button xpath=//button[contains(@class, "search")]';
    const requestBody = {
        steps: steps,
        xpaths: testXpaths,
    };

    try {
        const response = await axios.post('http://127.0.0.1:8080/execute', requestBody, {
            headers: {
                'Content-Type': 'application/json',
            },
        });
        return response.data;
    } catch (error) {
        if (error.response) {
            console.error('Server responded with:', error.response.status, error.response.data);
        } else {
            console.error('Error sending request:', error.message);
        }
        throw error;
    }
}

test('test web navigation', async () => {
    test.setTimeout(60000);
    console.log("entered into test web navigation");
    //await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for 10 seconds before sending steps
    const testSteps = 'Navigate to en.wikipedia.org';
    try {
        const response = await sendTestSteps(testSteps);
        expect(response.passed).toBe(true, `Test failed: ${result.details}`);
    } catch (error) {
        console.error('Request failed:', error.message);
        throw error;
    }
});