const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium, firefox } = require('playwright');
const { LLMClient } = require('./ServerLLM/LLMClient');


class MCPServer {

    constructor(configPath, operationsPath) {
        this.configPath = configPath;
        this.operationsPath = operationsPath;
        this.browsers = {};
        this.currentSession = null;
    }

    async init() {
        const config = await this.loadConfig(this.configPath);
        this.browserType = config['browser'] || 'chromium';
        this.port = parseInt(config['server.port'] || '8080');
        const llmEndpoint = config['llm.endpoint'] || 'http://localhost:11434';
        const llmModel = config['llm.model'] || 'gemma2:9b';
        const llmApiKey = config['llm.apiKey'] || '';
        this.llmClient = new LLMClient(llmEndpoint, llmModel, llmApiKey);
        this.supportedOperations = await this.loadOperations(this.operationsPath);
    }

    async loadConfig(configPath) {
        const props = {};
        try {
            const fileContent = fs.readFileSync(configPath, 'utf-8');
            const lines = fileContent.split('\n');
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#')) {
                    const [key, value] = trimmedLine.split('=').map(s => s.trim());
                    if (key && value) {
                        props[key] = value;
                    }
                }
            }
        } catch (e) {
            console.error("error", e)
        }
        return props;
    }

    async loadOperations(operationsPath) {
        const ops = {};
        const fileContent = fs.readFileSync(operationsPath, 'utf-8');
        const lines = fileContent.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const [key, value] = trimmedLine.split('=').map(s => s.trim());
                if (key && value) {
                    ops[key] = value.split(',').map(v => v.trim());
                }
            }
        }
        return ops;
    }

    async initializeBrowser(browserType, headless) {
        const isHeadless = headless === 'headless' || headless === true;
        switch (browserType.toLowerCase()) {
            case 'firefox':
                return await firefox.launch({ headless: isHeadless });
            case 'chrome':
            default:
                return await chromium.launch({ headless: isHeadless });
        }
    }

    getLocatorString(by, value) {
        switch (by.toLowerCase()) {
            case 'id': return `#${value}`;
            case 'css': return value;
            case 'xpath': return `xpath=${value}`;
            case 'name': return `[name="${value}"]`;
            case 'tag': return value;
            case 'class': return `.${value}`;
            default: throw new Error(`Unsupported locator strategy: ${by}`);
        }
    }

    async start() {
        const server = http.createServer(async (req, res) => {
            if (req.url === '/execute' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const request = JSON.parse(body);
                        const testSteps = request.steps;
                        const testXpaths = request.xpaths;

                        // Build LLM prompt
                        const llmPrompt = `You are a javascript playwright test automation expert. 
                        Convert the following test steps into a JSON array of Playwright commands each command must have a 'type' from this list: ${Object.keys(this.supportedOperations)} and include all required parameters: ${JSON.stringify(this.supportedOperations)}. 
                        Steps: ${testSteps}\nUse following xpaths for values:${testXpaths}\nNote: Respond with only json array of commands not extra characters. 
                        Include all commands and keep in order of execution
                        \n  A Sample for response for your reference in order of execution:
                        \n  {"type": "navigate", "url": "https://www.example.com"},
                        \n  {"type": "find_element", "by": "xpath", "value": "//input[@id="searchInput"]", "timeout": "5000"},
                        \n  {"type": "send_keys", "by": "xpath", "value": "//input[@id="searchtextbox"]", "text": "India", "timeout": "5000"},
                        \n  {"type": "click_element", "by": "xpath", "value": "//button[@type="submit"]", "timeout": "5000"}`;

                        // const llmPrompt = `You are a JavaScript Playwright test automation expert. Convert the following test steps into a JSON array of Playwright commands. Each command must have a 'type' from this list: ${Object.keys(this.supportedOperations)} and include all required parameters: ${JSON.stringify(this.supportedOperations)}. Steps: ${testSteps}
                        // Use the following xpaths for values: ${testXpaths}
                        // Note: Respond with only a JSON array of commands, no extra characters. Include all commands and keep in order of execution.
                        // A sample response for your reference in order of execution:
                        //     {"type": "navigate", "url": "https://www.example.com"},
                        //     {"type": "find_element", "by": "xpath", "value": "//input[@id=\\\"searchInput\\\"]", "timeout": "5000"},
                        //     {"type": "send_keys", "by": "xpath", "value": "//input[@id=\\\"searchtextbox\\\"]", "text": "India", "timeout": "5000"},
                        //     {"type": "click_element", "by": "xpath", "value": "//button[@type=\\\"submit\\\"]", "timeout": "5000"}`;

                        console.log("==========llmPrompt============");
                        console.log(llmPrompt);
                        console.log("================================");

                        let llmResponse = await this.llmClient.queryLlm(llmPrompt);
                        llmResponse = llmResponse.replace(/```/g, "");


                        console.log("==========llmResponse============");
                        console.log(llmResponse);
                        console.log("================================");

                        const commands = JSON.parse(llmResponse);

                        const sessionId = `${this.browserType}_${Date.now()}`;
                        const browser = await this.initializeBrowser(this.browserType, 'headed');
                        const context = await browser.newContext();
                        const page = await context.newPage();
                        this.browsers[sessionId] = { browser, context, page };
                        this.currentSession = sessionId;
                        console.log("currentSession: " + this.currentSession);

                        // Execute commands
                        let result = '';
                        let passed = true;
                        for (const cmd of commands) {
                            await new Promise(r => setTimeout(r, 5000));
                            try {
                                this.validateCommand(cmd);
                                const commandResult = await this.executeCommand(cmd, page);
                                result += `Command ${cmd.type}: ${commandResult}\n`;
                            } catch (e) {
                                passed = false;
                                result += `Command ${cmd.type} failed: ${e.message}\n`;
                            }
                        }

                        // Send response
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ passed, details: result }));

                        await browser.close();
                        delete this.browsers[sessionId];
                        this.currentSession = null;
                    } catch (e) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
            } else {
                res.writeHead(405, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Method not allowed' }));
            }
        });

        server.listen(this.port, () => {
            console.log(`MCP Server started on port ${this.port}`);
        });
        this.server = server;
    }

    validateCommand(cmd) {
        const type = cmd.type;
        if (!this.supportedOperations[type]) {
            throw new Error(`Unsupported command type: ${type}`);
        }
        const requiredParams = this.supportedOperations[type];
        for (const param of requiredParams) {
            if (!(param in cmd) || cmd[param] == null || cmd[param] === '') {
                throw new Error(`Missing required parameter '${param}' for command: ${type}`);
            }
        }
    }

    async executeCommand(cmd, page) {
        const type = cmd.type;
        const timeout = cmd.timeout ? parseInt(cmd.timeout, 10) : 10000;
        switch (type.toLowerCase) {
            case 'navigate':
                await page.goto(cmd.url, { timeout });
                return `Navigated to ${cmd.url}`;
            case 'find_element':
                if (cmd.getLocator === 'xpath') {
                    await page.waitForSelector(`xpath=${cmd.value}`, { timeout });
                } else {
                    await page.waitForSelector(this.getLocator(page, cmd.by, cmd.value), { timeout });
                }
                return 'Element found';
            case 'click_element':
                if (cmd.getLocator === 'xpath') {
                    await page.click(`xpath=${cmd.value}`, { timeout });
                } else {
                    await page.click(this.getLocator(page, cmd.by, cmd.value), { timeout });
                }
                return 'Element clicked';
            case 'send_keys':
                if (cmd.getLocator === 'xpath') {
                    await page.fill(`xpath=${cmd.value}`, cmd.text, { timeout });
                } else {
                    await page.fill(this.getLocator(page, cmd.by, cmd.value), cmd.text, { timeout });
                }
                return `Text '${cmd.text}' entered into element`;
            case 'get_element_text':
                let text;
                if (cmd.getLocator === 'xpath') {
                    text = await page.textContent(`xpath=${cmd.value}`, { timeout });
                } else {
                    text = await page.textContent(this.getLocator(page, cmd.by, cmd.value), { timeout });
                }
                return text;
            case 'hover':
                if (cmd.getLocator === 'xpath') {
                    await page.hover(`xpath=${cmd.value}`, { timeout });
                } else {
                    await page.hover(this.getLocator(page, cmd.by, cmd.value), { timeout });
                }
                return 'Hovered over element';
            case 'drag_and_drop':
                // Playwright does not have direct dragAndDrop, so simulate
                const source = cmd.by === 'xpath' ? await page.$(`xpath=${cmd.value}`) : await page.$(this.getLocator(page, cmd.by, cmd.value));
                const target = cmd.targetBy === 'xpath' ? await page.$(`xpath=${cmd.targetValue}`) : await page.$(this.getLocator(page, cmd.targetBy, cmd.targetValue));
                if (source && target) {
                    const sourceBox = await source.boundingBox();
                    const targetBox = await target.boundingBox();
                    if (sourceBox && targetBox) {
                        await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
                        await page.mouse.down();
                        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
                        await page.mouse.up();
                        return 'Drag and drop completed';
                    }
                }
                throw new Error('Drag and drop failed');
            case 'double_click':
                if (cmd.by === 'xpath') {
                    await page.dblclick(`xpath=${cmd.value}`, { timeout });
                } else {
                    await page.dblclick(this.getLocator(page, cmd.by, cmd.value), { timeout });
                }
                return 'Double click performed';
            case 'right_click':
                if (cmd.by === 'xpath') {
                    await page.click(`xpath=${cmd.value}`, { button: 'right', timeout });
                } else {
                    await page.click(this.getLocator(page, cmd.by, cmd.value), { button: 'right', timeout });
                }
                return 'Right click performed';
            case 'press_key':
                await page.keyboard.press(cmd.key, { timeout });
                return `Key '${cmd.key}' pressed`;
            case 'upload_file':
                if (cmd.by === 'xpath') {
                    const input = await page.$(`xpath=${cmd.value}`);
                    await input.setInputFiles(cmd.filePath);
                } else {
                    await page.setInputFiles(this.getLocator(page, cmd.by, cmd.value), cmd.filePath);
                }
                return 'File upload initiated';
            case 'take_screenshot':
                const screenshotPath = path.join(__dirname, `screenshot_${Date.now()}.png`);
                await page.screenshot({ path: screenshotPath });
                return `Screenshot captured at ${screenshotPath}`;
            case 'close_session':
                // Handled after commands loop
                return 'Browser session closed';
            default:
                throw new Error(`Unknown command type: ${type}`);
        }
    }

    getPage() {
        const session = this.browsers[this.currentSession];
        if (!session || !session.page) {
            throw new Error("No active browser session");
        }
        return session.page;
    }

    sendResponse(res, statusCode, response) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(typeof response === 'string' ? response : JSON.stringify(response));
    }

    async stopAllBrowsers() {
        for (const sessionId in this.browsers) {
            try {
                await this.browsers[sessionId].browser.close();
            } catch (e) {
                console.error("Error closing browser:", e.message);
            }
        }
        this.browsers = {};
        this.currentSession = null;
    }

    static async main() {
        const configPath = path.join(__dirname, 'resources', 'config.json');
        const operationsPath = path.join(__dirname, 'resources', 'operations.json');

        const server = new MCPServer(configPath, operationsPath);
        await server.init();
        server.start();
        process.on('SIGINT', () => server.stopAllBrowsers());
        process.on('SIGTERM', () => server.stopAllBrowsers());
    }
}

if (require.main === module) {
    (async () => {
        await MCPServer.main();
    })();
}