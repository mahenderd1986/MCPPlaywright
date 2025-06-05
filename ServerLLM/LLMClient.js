const axios = require('axios');

class LLMClient {
    constructor(endpoint, model, apiKey) {
        this.endpoint = endpoint;
        this.model = model;
        this.apiKey = apiKey;
    }

    async queryLlm(prompt) {
        let requestBody;
        if (this.endpoint.includes("localhost:11434")) {
            // Ollama API format
            requestBody = {
                model: this.model,
                prompt: prompt,
                stream: false
            };
        } else {
            // OpenAI-compatible API format
            requestBody = {
                model: this.model,
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            };
        }

        const url = this.endpoint + (this.endpoint.includes("localhost:11434") ? "/api/generate" : "/v1/chat/completions");
        const headers = {
            "Content-Type": "application/json",
            ...(this.apiKey && { "Authorization": `Bearer ${this.apiKey}` })
        };

        try {
            const response = await axios.post(url, requestBody, { headers });
            const responseBody = response.data;

            if (this.endpoint.includes("localhost:11434")) {
                return responseBody.response;
            } else {
                return responseBody.choices[0].message.content;
            }
        } catch (error) {
            throw new Error(`Error querying LLM: ${error.message}`);
        }
    }
}

module.exports = { LLMClient };