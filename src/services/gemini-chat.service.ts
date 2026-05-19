import { geminiClient, geminiModel } from '../config/gemini';
import { createUserContent } from '@google/genai';
import logger from '../utils/logger';
import { retryGeminiCall } from '../utils/gemini-errors';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GeminiChatResponse {
  response: string;
  tokens_used: number;
}

export class GeminiChatService {
  /**
   * Chat with Gemini about factory assembly line skills
   * Responses are always in Chinese
   * @param question - User's question about factory skills
   * @param conversationHistory - Optional previous messages for context
   * @returns AI response in Chinese with token usage
   */
  static async chat(
    question: string,
    conversationHistory: ChatMessage[] = []
  ): Promise<GeminiChatResponse> {
    try {
      logger.info('Starting Gemini chat for factory skills...');

      // Build conversation context
      let conversationContext = '';
      if (conversationHistory.length > 0) {
        conversationContext = '\n\n历史对话:\n';
        conversationHistory.forEach((msg) => {
          conversationContext += `${msg.role === 'user' ? '用户' : '助手'}: ${msg.content}\n`;
        });
      }

      const systemPrompt = `你是一个专业的工厂流水线技能培训专家。你的任务是帮助工人学习和理解工厂组装线的技能、安全规范和操作流程。

你的专业领域包括：
- 制造业流水线操作
- 工业设备操作和维护
- 质量控制和检验技术
- 工厂安全规范和程序
- 机械设备使用（齿轮、工具、机器等）
- 生产效率优化
- 标准操作流程 (SOP)
- 故障排除和问题解决

回答要求：
1. **必须使用中文回答所有问题**
2. 提供清晰、实用的建议
3. 使用简单易懂的语言，适合工人理解
4. 如果涉及安全问题，务必强调安全注意事项
5. 提供具体的步骤和例子
6. 保持专业和友好的语气

${conversationContext}

现在请回答以下问题：
${question}`;

      const response = await retryGeminiCall(async () => {
        return await geminiClient.models.generateContent({
          model: geminiModel,
          contents: createUserContent([systemPrompt]),
          config: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          },
        });
      });

      if (!response.text) {
        throw new Error('No response text received from Gemini');
      }

      // Get token count from response metadata
      const tokensUsed: number = response.usageMetadata?.totalTokenCount || 0;

      logger.info(`Chat response generated. Tokens used: ${tokensUsed}`);

      return {
        response: response.text,
        tokens_used: tokensUsed,
      };
    } catch (error: any) {
      logger.error('Gemini chat error:', error);
      throw new Error(`Chat failed: ${error.message}`);
    }
  }
}

export default GeminiChatService;
