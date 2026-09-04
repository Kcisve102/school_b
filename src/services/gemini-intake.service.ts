import { geminiClient, geminiModel } from '../config/gemini';
import { createUserContent, Type } from '@google/genai';
import logger from '../utils/logger';
import { retryGeminiCall } from '../utils/gemini-errors';
import {
  INTAKE_SECTIONS,
  IntakeAnswer,
  IntakeQuestion,
  ProfileLink,
  ResumeCertification,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
  StructuredResumeDraft,
} from '../types/profile.types';

/**
 * What the learner already has on file. Counts only, never contents: the
 * question planner needs to know whether a section is empty, not what is in it,
 * and sending the contents would just cost tokens.
 */
export interface ProfileCoverage {
  headline: string;
  summary: string;
  skills: string[];
  experienceCount: number;
  educationCount: number;
  projectCount: number;
  certificationCount: number;
  hasPhone: boolean;
  hasCity: boolean;
  linkCount: number;
}

const MIN_QUESTIONS = 4;
const MAX_QUESTIONS = 7;

/**
 * The honesty contract, shared by both calls in this file and worded to match
 * the one in gemini-career-profile.service.ts.
 *
 * This is the whole reason the intake exists. The resume is pasted onto real
 * job boards under the learner's real name, so an invented employer is not a
 * cosmetic flaw — it is a false statement attributed to them, and one they may
 * have to answer for in an interview.
 */
const HONESTY_CONTRACT = `CRITICAL HONESTY CONSTRAINTS — these matter more than polish:

- NEVER invent an employer, job title, date, school, qualification, certificate,
  location, tool, metric or achievement. If the learner did not state it, it does
  not exist.
- NEVER upgrade what they said. "Helped out at" is not "led". "Worked shifts" is
  not "managed operations". Keep their own level of claim.
- NEVER add numbers. If they gave no figure, there is no figure. Do not write
  "increased sales by 20%" or "served 100 customers a day" unless they said so.
- NEVER claim years of experience, seniority, or expertise the learner did not
  state. No "seasoned", no "expert", no "extensive background".

Returning an empty field is CORRECT when the learner did not supply that fact. A
short honest resume is far better for this person than a fuller invented one.`;

const intakeQuestionsSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      description: `Between ${MIN_QUESTIONS} and ${MAX_QUESTIONS} questions, most important first`,
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.STRING,
            description: 'lower_snake_case slug, unique within the list',
          },
          section: {
            type: Type.STRING,
            enum: [...INTAKE_SECTIONS],
            description: 'Which resume section this answer will populate',
          },
          prompt: {
            type: Type.STRING,
            description:
              'The question itself, max 160 characters, second person, plain language',
          },
          helper: {
            type: Type.STRING,
            description:
              'One short sentence telling the learner what a useful answer contains, max 140 characters',
          },
          placeholder: {
            type: Type.STRING,
            description: 'A short example answer, max 80 characters',
          },
          optional: {
            type: Type.BOOLEAN,
            description: 'True if a usable resume is still possible without this answer',
          },
        },
        required: ['id', 'section', 'prompt', 'helper', 'placeholder', 'optional'],
      },
      minItems: MIN_QUESTIONS,
      maxItems: MAX_QUESTIONS,
    },
  },
  required: ['questions'],
};

/**
 * Deliberately terse.
 *
 * Gemini's structured-output engine rejects a schema whose total state space is
 * too large, and long per-field descriptions on nested arrays of objects are
 * what push it over ("too many states for serving"). The honesty rules that
 * used to live in these descriptions are in the prompt instead, which is where
 * they carry more weight anyway — the schema's job here is shape, not policy.
 *
 * Nullable optional fields matter and stay: they give the model a legal way to
 * say "the learner did not tell me" instead of inventing a value to satisfy a
 * required string.
 */
const experienceItemSchema = {
  type: Type.OBJECT,
  properties: {
    role: { type: Type.STRING },
    employer: { type: Type.STRING },
    location: { type: Type.STRING, nullable: true },
    start: { type: Type.STRING },
    end: { type: Type.STRING, nullable: true },
    current: { type: Type.BOOLEAN },
    bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['role', 'employer', 'start', 'current', 'bullets'],
};

const structuredResumeSchema = {
  type: Type.OBJECT,
  properties: {
    experience: { type: Type.ARRAY, items: experienceItemSchema },
    education: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          credential: { type: Type.STRING },
          institution: { type: Type.STRING },
          location: { type: Type.STRING, nullable: true },
          start: { type: Type.STRING, nullable: true },
          end: { type: Type.STRING, nullable: true },
          detail: { type: Type.STRING, nullable: true },
        },
        required: ['credential', 'institution'],
      },
    },
    projects: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          detail: { type: Type.STRING, nullable: true },
          link: { type: Type.STRING, nullable: true },
        },
        required: ['name'],
      },
    },
    certifications: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          issuer: { type: Type.STRING, nullable: true },
          issued: { type: Type.STRING, nullable: true },
        },
        required: ['name'],
      },
    },
    phone: { type: Type.STRING, nullable: true },
    city: { type: Type.STRING, nullable: true },
    links: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { label: { type: Type.STRING }, url: { type: Type.STRING } },
        required: ['label', 'url'],
      },
    },
    headline: { type: Type.STRING },
    summary: { type: Type.STRING },
    skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    job_titles: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    'experience',
    'education',
    'projects',
    'certifications',
    'links',
    'headline',
    'summary',
    'skills',
    'job_titles',
  ],
};

/**
 * Gemini returns the four-character string "null" for an absent nullable field
 * about as often as it returns a real JSON null. Left alone that reaches the
 * resume and prints the word "null" where an employer's name should be, so
 * every string that arrived is normalised here rather than in each renderer.
 *
 * "none", "n/a" and the empty string get the same treatment: they are the
 * model reporting an absence, not a fact the learner stated.
 */
const ABSENT_TEXT = new Set(['null', 'undefined', 'n/a', 'na', 'none', '-', '']);

function nullish(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return ABSENT_TEXT.has(trimmed.toLowerCase()) ? null : trimmed;
}

/**
 * Drops entries whose required fields did not survive normalisation.
 *
 * If the model wrote "null" for an employer it did not know, `cleanEntry` turns
 * that into a real null and the entry is no longer a fact — it is a fragment.
 * Filtering here rather than letting it through matters: the save endpoint
 * rejects an entry with a missing required field, so an unfiltered fragment
 * would fail the learner's save with a validation error they cannot act on.
 */
function hasRequired<T>(entry: T, keys: (keyof T)[]): boolean {
  return keys.every((key) => {
    const value = entry[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

/** Applies `nullish` to every string field of one structured entry. */
function cleanEntry<T>(entry: T): T {
  if (typeof entry !== 'object' || entry === null) return entry;
  const out: Record<string, unknown> = { ...(entry as Record<string, unknown>) };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === 'string') {
      out[key] = nullish(value);
    } else if (Array.isArray(value)) {
      out[key] = value
        .map((item) => (typeof item === 'string' ? nullish(item) : item))
        .filter((item) => item !== null);
    }
  }
  return out as T;
}

export class GeminiIntakeService {
  /**
   * Plans the questions to ask this learner for this target role.
   *
   * The adaptivity that matters is WHICH questions get asked — a solar
   * installer should be asked about site work and safety tickets, a bookkeeper
   * about systems and software. That does not require a turn-by-turn
   * conversation, so this is a single call returning the whole plan; the client
   * paces it one question per screen.
   */
  static async planQuestions(
    targetRole: string,
    coverage: ProfileCoverage
  ): Promise<{ questions: IntakeQuestion[]; tokens_used: number }> {
    try {
      logger.info(`Planning resume intake questions for target role: ${targetRole}`);

      const prompt = `You are preparing a short intake form for a learner who is about to apply for jobs. You are NOT writing a resume — you are deciding what to ask them.

TARGET ROLE THEY ARE AIMING FOR: ${targetRole}

WHAT WE ALREADY HAVE ON FILE:
- Headline: ${coverage.headline || '(none)'}
- Summary: ${coverage.summary || '(none)'}
- Skills already listed (${coverage.skills.length}): ${coverage.skills.join(', ') || '(none)'}
- Work experience entries: ${coverage.experienceCount}
- Education entries: ${coverage.educationCount}
- Project entries: ${coverage.projectCount}
- Certification entries: ${coverage.certificationCount}
- Phone on file: ${coverage.hasPhone ? 'yes' : 'no'}
- City on file: ${coverage.hasCity ? 'yes' : 'no'}
- Links on file: ${coverage.linkCount}

This learner's profile was built from an online course they completed. Assume they may have NO formal employment history in this field at all.

Ask ONLY for facts that are missing above. Rules:

1. One thing per question. Never bundle "where did you work and what did you study".
2. Do not ask about anything already on file.
3. Ask only for CHECKABLE FACTS: where they worked, what they did there, what they
   studied, what they built, what certificates they hold, how to contact them.
   Do NOT ask about motivations, strengths, career goals or "why this role" —
   this is a resume, not a cover letter.
4. Tailor to the target role. A hands-on trade role warrants questions about
   tools, sites, tickets and safety certificates; an office role warrants
   questions about software and systems; a first job warrants questions about
   volunteering, school projects and informal or family work instead of employers.
5. Phrase questions so that "I have none" is an acceptable answer. Never write a
   question that assumes they have held a professional job.
6. Mark a question optional when a usable resume is still possible without it.
7. Ask at most one contact question, and combine phone/city/links into it.
8. The placeholder is an EXAMPLE ANSWER, and learners copy the shape of what
   they are shown. Never put a statistic, percentage or invented achievement in
   one ("improved satisfaction by 15%" teaches them to make a number up). Keep
   placeholders plain and factual, e.g. "Served customers and restocked shelves".
9. Do not use the words "achievements", "impact" or "results" in a question.
   Ask what they DID, not what they accomplished — the second phrasing is what
   makes people embellish.

${HONESTY_CONTRACT}

Write the questions in English.`;

      const response = await retryGeminiCall(async () => {
        return await geminiClient.models.generateContent({
          model: geminiModel,
          contents: createUserContent([prompt]),
          config: {
            responseMimeType: 'application/json',
            responseSchema: intakeQuestionsSchema,
            temperature: 0.6,
          },
        });
      });

      if (!response.text) {
        throw new Error('No response text received from Gemini');
      }

      const result = JSON.parse(response.text);
      const tokensUsed: number = response.usageMetadata?.totalTokenCount || 0;

      // The schema constrains shape but not uniqueness, and a duplicate id would
      // make two questions share one answer slot in the client.
      const seen = new Set<string>();
      const questions: IntakeQuestion[] = (Array.isArray(result.questions) ? result.questions : [])
        .filter((q: IntakeQuestion) => q && typeof q.id === 'string' && !seen.has(q.id) && seen.add(q.id))
        .filter((q: IntakeQuestion) => INTAKE_SECTIONS.includes(q.section))
        .slice(0, MAX_QUESTIONS);

      if (questions.length === 0) {
        throw new Error('Gemini returned no usable intake questions');
      }

      logger.info(`Intake plan ready. Questions: ${questions.length}, Tokens: ${tokensUsed}`);

      return { questions, tokens_used: tokensUsed };
    } catch (error: any) {
      logger.error('Gemini intake planning error:', error);
      throw new Error(`Intake question planning failed: ${error.message}`);
    }
  }

  /**
   * Turns the learner's free-text answers into structured resume sections.
   *
   * This is the call where fabrication would enter, so it is deliberately the
   * most constrained one in the codebase: temperature is low because this is an
   * extraction task rather than a creative one, every optional field is
   * nullable so the model has a legal way to decline instead of confabulating,
   * and the result is shown to the learner for review before anything is saved.
   */
  static async structureAnswers(
    fullName: string,
    targetRole: string,
    answers: IntakeAnswer[],
    coverage: ProfileCoverage
  ): Promise<{ draft: StructuredResumeDraft; tokens_used: number }> {
    try {
      logger.info(`Structuring ${answers.length} intake answers for role: ${targetRole}`);

      const answerBlock = answers
        .map(
          (a, idx) =>
            `${idx + 1}. [${a.section}] QUESTION: ${a.prompt}\n   THEIR ANSWER: ${a.answer}`
        )
        .join('\n\n');

      const prompt = `You are formatting a learner's own words into resume sections. You are NOT writing new content.

LEARNER NAME: ${fullName}
TARGET ROLE: ${targetRole}

SKILLS ALREADY ON THEIR PROFILE: ${coverage.skills.join(', ') || '(none)'}
EXISTING HEADLINE: ${coverage.headline || '(none)'}
EXISTING SUMMARY: ${coverage.summary || '(none)'}

WHAT THEY TOLD US:

${answerBlock}

YOUR TASK — split the above into structured fields and tidy the wording.

You MAY: fix spelling, capitalisation and grammar; split a run-on answer into
separate bullet points; drop filler words; put their words into a consistent
tense.

You MAY NOT: add anything they did not say. Read that again before you start.

If an answer is vague ("worked at a shop for a bit"), capture exactly that much
— employer "a shop" is wrong, so if they did not name the employer, do not
create an entry you cannot fill honestly. Prefer FEWER, TRUER entries.
If an answer says they have none of something, return an empty array for it.

${HONESTY_CONTRACT}

Also produce:
- headline: max 120 characters, aimed at the target role. If they now have real
  work history, it may reflect that; if they do not, keep it entry-level.
- summary: 3-5 first-person sentences drawing ONLY on the facts above and the
  existing profile. No new claims.
- skills: merge the existing skills with any genuinely evidenced by their
  answers. Do not pad the list to reach a count.
- job_titles: 3-5 realistic titles to search for, given the target role and what
  they have actually done.

Write everything in English.`;

      const response = await retryGeminiCall(async () => {
        return await geminiClient.models.generateContent({
          model: geminiModel,
          contents: createUserContent([prompt]),
          config: {
            responseMimeType: 'application/json',
            responseSchema: structuredResumeSchema,
            // Low, unlike the 0.7 used for the initial draft: this is an
            // extraction task, and sampling variety here means invention.
            temperature: 0.2,
          },
        });
      });

      if (!response.text) {
        throw new Error('No response text received from Gemini');
      }

      const result = JSON.parse(response.text);
      const tokensUsed: number = response.usageMetadata?.totalTokenCount || 0;

      const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

      const draft: StructuredResumeDraft = {
        experience: asArray<ResumeExperience>(result.experience)
          .map(cleanEntry)
          .filter((e) => hasRequired(e, ['role', 'employer', 'start'])),
        education: asArray<ResumeEducation>(result.education)
          .map(cleanEntry)
          // Only `credential` is required: a learner may well say "finished
          // high school in 2019" without naming the school, and that is still a
          // true education entry worth carrying onto the resume.
          .filter((e) => hasRequired(e, ['credential'])),
        projects: asArray<ResumeProject>(result.projects)
          .map(cleanEntry)
          .filter((e) => hasRequired(e, ['name'])),
        certifications: asArray<ResumeCertification>(result.certifications)
          .map(cleanEntry)
          .filter((e) => hasRequired(e, ['name'])),
        phone: nullish(result.phone),
        city: nullish(result.city),
        links: asArray<ProfileLink>(result.links)
          .map(cleanEntry)
          .filter((e) => hasRequired(e, ['label', 'url'])),
        headline: result.headline ?? '',
        summary: result.summary ?? '',
        skills: asArray(result.skills),
        job_titles: asArray(result.job_titles),
      };

      logger.info(
        `Intake structured. Experience: ${draft.experience.length}, Education: ${draft.education.length}, Tokens: ${tokensUsed}`
      );

      return { draft, tokens_used: tokensUsed };
    } catch (error: any) {
      logger.error('Gemini intake structuring error:', error);
      throw new Error(`Intake structuring failed: ${error.message}`);
    }
  }
}

export default GeminiIntakeService;
