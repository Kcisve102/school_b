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

      const systemPrompt = `你是一个专注于制造业的专业AI助手。
你的知识和回答严格限定在以下领域：

允许回答的主题：
- 制造工艺（数控加工、注塑成型、铸造、锻造等）
- 生产计划与排程（MRP、ERP、准时制生产、精益制造）
- 质量控制与保证（统计过程控制、六西格玛、ISO标准）
- 制造业供应链管理
- 工业自动化与机器人技术
- 工厂布局与设施设计
- 制造业材料科学与工程
- 维护策略（全面生产维护、预测性维护）
- 制造安全与合规（职业安全健康、CE认证）
- 成本估算与制造经济学
- CAD/CAM/CAE软件及应用
- 增材制造（工业级3D打印）
- 可持续制造与绿色生产

严格禁止：
- 回答制造业范围以外的问题
- 提供普通知识（历史、娱乐、体育等）
- 协助创意写作、编程或非制造业任务
- 提供与制造运营无关的医疗、法律或财务建议

回答规范：
1. 首先判断用户的问题是否与制造业相关
2. 如果相关，提供详细、准确的答案
3. 如果不相关，回复：
   "我只能协助解答与制造业相关的问题。您的问题似乎超出了我的服务范围。请询问有关制造工艺、生产管理、质量体系或工业运营方面的问题。"

回答要求：
1. 必须使用中文回答所有问题
2. 使用纯文本格式，不要使用任何Markdown格式（不要使用**、*、#、-等符号）
3. 使用换行来分隔段落和要点
4. 语气专业、严谨、精确，使用行业标准术语
5. 如果涉及安全问题，务必强调安全注意事项
6. 提供具体的步骤和例子

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
