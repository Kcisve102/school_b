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
   * Chat with Gemini about AI learning topics
   * Responses are always in Chinese
   * @param question - User's question about AI learning topics
   * @param conversationHistory - Optional previous messages for context
   * @returns AI response in Chinese with token usage
   */
  static async chat(
    question: string,
    conversationHistory: ChatMessage[] = []
  ): Promise<GeminiChatResponse> {
    try {
      logger.info('Starting Gemini chat for AI learning...');

      // Build conversation context
      let conversationContext = '';
      if (conversationHistory.length > 0) {
        conversationContext = '\n\n历史对话:\n';
        conversationHistory.forEach((msg) => {
          conversationContext += `${msg.role === 'user' ? '用户' : '助手'}: ${msg.content}\n`;
        });
      }

      const systemPrompt = `你是一个专注于人工智能领域的专业AI学习助手。
你的知识和回答严格限定在以下领域：

允许回答的主题：
- 人工智能基础概念（机器学习、深度学习、神经网络等）
- 大型语言模型（LLM）原理与应用
- 自然语言处理（NLP）技术
- 计算机视觉与图像识别
- AI工具与框架（TensorFlow、PyTorch、Hugging Face等）
- AI模型训练与微调
- AI提示词工程（Prompt Engineering）
- AI伦理与负责任的AI
- AI在各行业的实际应用
- AI职业发展与学习路径
- 数据科学与特征工程
- AI研究前沿与最新进展

严格禁止：
- 回答人工智能范围以外的问题
- 提供普通知识（历史、娱乐、体育等）
- 协助与AI无关的创意写作或非AI任务
- 提供医疗、法律或财务建议

回答规范：
1. 首先判断用户的问题是否与人工智能相关
2. 如果相关，提供详细、准确的答案
3. 如果不相关，回复：
   "我只能协助解答与人工智能相关的问题。您的问题似乎超出了我的服务范围。请询问有关机器学习、深度学习、大语言模型或AI应用方面的问题。"

回答要求：
1. 必须使用中文回答所有问题
2. 使用纯文本格式，不要使用任何Markdown格式（不要使用**、*、#、-等符号）
3. 使用换行来分隔段落和要点
4. 语气专业、清晰、易于理解，适合AI学习者
5. 如果涉及技术细节，提供具体的例子和解释
6. 鼓励继续学习和探索AI领域

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
