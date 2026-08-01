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

/**
 * The lesson a question is being asked about. When present the assistant
 * answers from this material instead of from general knowledge.
 */
export interface VideoContext {
  title: string;
  transcript: string;
  summary?: string;
  keyPoints?: string[];
  segments?: { start: number; text: string }[];
}

/**
 * Gemini 2.5 Flash holds roughly a million tokens, and the longest transcript
 * in the library is ~16k characters, so the full text fits comfortably. This
 * cap only exists so a pathologically long future transcript cannot blow the
 * window; it keeps the head and tail, which is where topic and conclusion live.
 */
const MAX_CONTEXT_CHARS = 200_000;

function capTranscript(transcript: string): string {
  if (transcript.length <= MAX_CONTEXT_CHARS) return transcript;
  const half = Math.floor(MAX_CONTEXT_CHARS / 2);
  return `${transcript.slice(0, half)}\n\n[... 中间部分因长度省略 ...]\n\n${transcript.slice(-half)}`;
}

/**
 * The prompt asks for plain text, but the model still emits `**bold**` and
 * `*` bullets often enough to matter — and the chat UI renders raw text, so
 * those show up as literal asterisks. Stripping them here is deterministic;
 * asking more firmly in the prompt is not.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/(^|\s)\*(?!\s)(.+?)(?<!\s)\*(?=\s|$|[，。！？、）])/g, '$1$2') // italics
    .replace(/^\s*[*+-]\s+/gm, '• ') // bullet markers
    .replace(/^\s*#{1,6}\s+/gm, '') // headings
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/`/g, ''); // stray unpaired backticks
}

/** Sampled so the model can cite timestamps without shipping every segment. */
const MAX_OUTLINE_SEGMENTS = 120;

/**
 * Timestamps are pre-formatted as M:SS because the model is asked to cite them
 * in that form. Handing it raw seconds made it do the conversion itself, and it
 * got the arithmetic wrong — producing impossible citations like "7:88".
 */
function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function buildTimestampedOutline(
  segments: { start: number; text: string }[]
): string {
  if (!segments.length) return '';
  const step = Math.max(1, Math.ceil(segments.length / MAX_OUTLINE_SEGMENTS));
  return segments
    .filter((_, i) => i % step === 0)
    .map((s) => `[${formatTimestamp(s.start)}] ${s.text}`)
    .join('\n');
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
    conversationHistory: ChatMessage[] = [],
    videoContext?: VideoContext
  ): Promise<GeminiChatResponse> {
    try {
      logger.info(
        videoContext
          ? `Starting Gemini chat grounded in video: ${videoContext.title}`
          : 'Starting Gemini chat for AI learning...'
      );

      // Build conversation context
      let conversationContext = '';
      if (conversationHistory.length > 0) {
        conversationContext = '\n\n历史对话:\n';
        conversationHistory.forEach((msg) => {
          conversationContext += `${msg.role === 'user' ? '用户' : '助手'}: ${msg.content}\n`;
        });
      }

      const systemPrompt = videoContext
        ? this.buildGroundedPrompt(question, conversationContext, videoContext)
        : this.buildGlobalPrompt(question, conversationContext);

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
        response: stripMarkdown(response.text),
        tokens_used: tokensUsed,
      };
    } catch (error: any) {
      logger.error('Gemini chat error:', error);
      throw new Error(`Chat failed: ${error.message}`);
    }
  }

  /**
   * Grounded in one lesson.
   *
   * Deliberately omits the global prompt's topic whitelist: scope here comes
   * from the transcript, not a blocklist. The library includes "Language" and
   * "Other" categories, so an AI-only filter would make the assistant refuse
   * legitimate questions about the very video the learner is watching.
   */
  private static buildGroundedPrompt(
    question: string,
    conversationContext: string,
    context: VideoContext
  ): string {
    const outline = context.segments?.length
      ? buildTimestampedOutline(context.segments)
      : '';

    const summaryBlock = context.summary
      ? `\n\n课程摘要:\n${context.summary}`
      : '';
    const keyPointsBlock = context.keyPoints?.length
      ? `\n\n课程要点:\n${context.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
      : '';
    const outlineBlock = outline
      ? `\n\n带时间戳的字幕（引用时间点时请使用这些时间）:\n${outline}`
      : '';

    return `你是一位专业的课程助教，正在帮助学员理解他们正在观看的这节课。

课程标题: ${context.title}

回答要求：
1. 必须依据下面提供的课程内容作答，而不是泛泛而谈的通用知识。
2. 如果课程中确实没有涉及某个问题，请如实说明这节课没有讲到，然后再简要补充你的理解，不要编造课程内容。
3. 如果答案对应课程中的某个时间点，请注明，例如"（提到于 3:20）"。时间必须直接照抄下面字幕中方括号里的时间，不要自己换算。
4. 必须使用中文回答所有问题。
5. 使用纯文本格式，不要使用任何Markdown格式（不要使用**、*、#、-等符号）。
6. 使用换行来分隔段落和要点。
7. 语气专业、耐心、鼓励，适合正在学习的学员。

课程完整字幕:
${capTranscript(context.transcript)}${summaryBlock}${keyPointsBlock}${outlineBlock}${conversationContext}

现在请回答学员的问题：
${question}`;
  }

  /** The original library-wide AI tutor, unchanged. */
  private static buildGlobalPrompt(
    question: string,
    conversationContext: string
  ): string {
    return `你是一个专注于人工智能领域的专业AI学习助手。
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
  }
}

export default GeminiChatService;
