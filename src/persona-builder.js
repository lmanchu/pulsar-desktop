/**
 * Pulsar Persona Builder
 * Creates personalized writing personas from MBTI + Social Profile analysis
 * Adapted for Electron desktop app
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class PersonaBuilder {
  constructor() {
    this.dataPath = path.join(app.getPath('userData'), 'persona-data.json');
  }

  // MBTI Dimension mappings
  MBTI_DIMENSIONS = {
    E_I: { E: 'Extraversion', I: 'Introversion' },
    S_N: { S: 'Sensing', N: 'Intuition' },
    T_F: { T: 'Thinking', F: 'Feeling' },
    J_P: { J: 'Judging', P: 'Perceiving' }
  };

  // MBTI Questions (simplified 16-question version)
  MBTI_QUESTIONS = [
    // E vs I (4 questions)
    {
      id: 'ei1',
      dimension: 'E_I',
      question: 'At social events, you typically:',
      options: [
        { value: 'E', text: 'Talk to many people, including strangers' },
        { value: 'I', text: 'Talk to a few people you already know' }
      ]
    },
    {
      id: 'ei2',
      dimension: 'E_I',
      question: 'You recharge your energy by:',
      options: [
        { value: 'E', text: 'Being around other people' },
        { value: 'I', text: 'Spending time alone' }
      ]
    },
    {
      id: 'ei3',
      dimension: 'E_I',
      question: 'When working on projects, you prefer:',
      options: [
        { value: 'E', text: 'Collaborating with a team' },
        { value: 'I', text: 'Working independently' }
      ]
    },
    {
      id: 'ei4',
      dimension: 'E_I',
      question: 'Your social media posting style is:',
      options: [
        { value: 'E', text: 'Frequent, sharing thoughts as they come' },
        { value: 'I', text: 'Selective, posting only when something feels significant' }
      ]
    },
    // S vs N (4 questions)
    {
      id: 'sn1',
      dimension: 'S_N',
      question: 'When learning something new, you prefer:',
      options: [
        { value: 'S', text: 'Practical examples and step-by-step instructions' },
        { value: 'N', text: 'Understanding the big picture and concepts first' }
      ]
    },
    {
      id: 'sn2',
      dimension: 'S_N',
      question: 'In conversations, you tend to focus on:',
      options: [
        { value: 'S', text: 'Facts, details, and what actually happened' },
        { value: 'N', text: 'Meanings, possibilities, and implications' }
      ]
    },
    {
      id: 'sn3',
      dimension: 'S_N',
      question: 'When writing content, you prefer:',
      options: [
        { value: 'S', text: 'Concrete examples and proven methods' },
        { value: 'N', text: 'Novel ideas and future possibilities' }
      ]
    },
    {
      id: 'sn4',
      dimension: 'S_N',
      question: 'You are more interested in:',
      options: [
        { value: 'S', text: 'What is real and current' },
        { value: 'N', text: 'What could be and what\'s next' }
      ]
    },
    // T vs F (4 questions)
    {
      id: 'tf1',
      dimension: 'T_F',
      question: 'When making decisions, you primarily rely on:',
      options: [
        { value: 'T', text: 'Logic and objective analysis' },
        { value: 'F', text: 'Values and how people will be affected' }
      ]
    },
    {
      id: 'tf2',
      dimension: 'T_F',
      question: 'In disagreements, you value:',
      options: [
        { value: 'T', text: 'Being right and finding the truth' },
        { value: 'F', text: 'Maintaining harmony and understanding feelings' }
      ]
    },
    {
      id: 'tf3',
      dimension: 'T_F',
      question: 'Your writing tone tends to be:',
      options: [
        { value: 'T', text: 'Direct, analytical, and matter-of-fact' },
        { value: 'F', text: 'Warm, personal, and empathetic' }
      ]
    },
    {
      id: 'tf4',
      dimension: 'T_F',
      question: 'You are more motivated by:',
      options: [
        { value: 'T', text: 'Achievement and competence' },
        { value: 'F', text: 'Recognition and appreciation' }
      ]
    },
    // J vs P (4 questions)
    {
      id: 'jp1',
      dimension: 'J_P',
      question: 'Your approach to deadlines:',
      options: [
        { value: 'J', text: 'Plan ahead and finish early' },
        { value: 'P', text: 'Work best under pressure, flexible timing' }
      ]
    },
    {
      id: 'jp2',
      dimension: 'J_P',
      question: 'You prefer your content calendar to be:',
      options: [
        { value: 'J', text: 'Structured with planned posts' },
        { value: 'P', text: 'Flexible, posting when inspiration strikes' }
      ]
    },
    {
      id: 'jp3',
      dimension: 'J_P',
      question: 'When starting a project, you:',
      options: [
        { value: 'J', text: 'Create a detailed plan first' },
        { value: 'P', text: 'Dive in and figure it out as you go' }
      ]
    },
    {
      id: 'jp4',
      dimension: 'J_P',
      question: 'You feel more comfortable when things are:',
      options: [
        { value: 'J', text: 'Decided and settled' },
        { value: 'P', text: 'Open to change and new information' }
      ]
    }
  ];

  // MBTI Type Profiles with writing characteristics
  MBTI_PROFILES = {
    INTJ: {
      name: 'The Architect',
      traits: ['Strategic', 'Independent', 'Analytical', 'Determined'],
      writingStyle: {
        tone: 'Confident and authoritative',
        structure: 'Logical, well-organized arguments',
        strengths: ['Big-picture thinking', 'Unique insights', 'Direct communication'],
        tendencies: ['May come across as blunt', 'Prefers depth over breadth']
      },
      socialMediaTips: 'Share strategic insights and contrarian views. Quality over quantity.'
    },
    INTP: {
      name: 'The Logician',
      traits: ['Analytical', 'Objective', 'Reserved', 'Flexible'],
      writingStyle: {
        tone: 'Thoughtful and exploratory',
        structure: 'Complex ideas explained simply',
        strengths: ['Deep analysis', 'Novel perspectives', 'Technical clarity'],
        tendencies: ['May over-explain', 'Abstract concepts']
      },
      socialMediaTips: 'Share interesting problems and elegant solutions. Embrace complexity.'
    },
    ENTJ: {
      name: 'The Commander',
      traits: ['Bold', 'Imaginative', 'Strong-willed', 'Strategic'],
      writingStyle: {
        tone: 'Assertive and decisive',
        structure: 'Clear calls to action',
        strengths: ['Leadership voice', 'Motivational', 'Goal-oriented'],
        tendencies: ['May seem demanding', 'Impatient with details']
      },
      socialMediaTips: 'Lead with vision. Share wins and lessons learned.'
    },
    ENTP: {
      name: 'The Debater',
      traits: ['Quick', 'Ingenious', 'Stimulating', 'Alert'],
      writingStyle: {
        tone: 'Witty and provocative',
        structure: 'Engaging hooks, unexpected angles',
        strengths: ['Debate-sparking', 'Creative connections', 'Humor'],
        tendencies: ['May play devil\'s advocate', 'Easily bored']
      },
      socialMediaTips: 'Challenge assumptions. Use humor and hot takes.'
    },
    INFJ: {
      name: 'The Advocate',
      traits: ['Insightful', 'Principled', 'Compassionate', 'Private'],
      writingStyle: {
        tone: 'Thoughtful and meaningful',
        structure: 'Story-driven, values-based',
        strengths: ['Deep empathy', 'Inspiring messages', 'Authentic voice'],
        tendencies: ['May be too idealistic', 'Selective sharing']
      },
      socialMediaTips: 'Share meaningful stories. Connect on values.'
    },
    INFP: {
      name: 'The Mediator',
      traits: ['Idealistic', 'Empathetic', 'Creative', 'Reserved'],
      writingStyle: {
        tone: 'Genuine and heartfelt',
        structure: 'Personal narratives, metaphors',
        strengths: ['Emotional resonance', 'Creative expression', 'Authenticity'],
        tendencies: ['May be too personal', 'Vulnerable sharing']
      },
      socialMediaTips: 'Share personal journeys. Embrace vulnerability.'
    },
    ENFJ: {
      name: 'The Protagonist',
      traits: ['Charismatic', 'Inspiring', 'Reliable', 'Altruistic'],
      writingStyle: {
        tone: 'Warm and encouraging',
        structure: 'Community-focused, uplifting',
        strengths: ['Building connections', 'Motivational', 'Supportive'],
        tendencies: ['May over-promise', 'People-pleasing']
      },
      socialMediaTips: 'Celebrate others. Build community.'
    },
    ENFP: {
      name: 'The Campaigner',
      traits: ['Enthusiastic', 'Creative', 'Sociable', 'Free-spirited'],
      writingStyle: {
        tone: 'Energetic and optimistic',
        structure: 'Spontaneous, idea-rich',
        strengths: ['Infectious enthusiasm', 'Creative ideas', 'Relatability'],
        tendencies: ['May lack follow-through', 'Scattered topics']
      },
      socialMediaTips: 'Share excitement. Explore many interests openly.'
    },
    ISTJ: {
      name: 'The Logistician',
      traits: ['Practical', 'Fact-minded', 'Reliable', 'Dutiful'],
      writingStyle: {
        tone: 'Clear and factual',
        structure: 'Step-by-step, well-researched',
        strengths: ['Trustworthy information', 'Consistent quality', 'Detail-oriented'],
        tendencies: ['May seem dry', 'Resistant to new formats']
      },
      socialMediaTips: 'Share proven methods. Be the reliable expert.'
    },
    ISFJ: {
      name: 'The Defender',
      traits: ['Supportive', 'Reliable', 'Patient', 'Observant'],
      writingStyle: {
        tone: 'Helpful and considerate',
        structure: 'Practical tips, gentle guidance',
        strengths: ['Thoughtful advice', 'Community care', 'Consistency'],
        tendencies: ['May undersell self', 'Too modest']
      },
      socialMediaTips: 'Help others succeed. Share what works.'
    },
    ESTJ: {
      name: 'The Executive',
      traits: ['Organized', 'Logical', 'Assertive', 'Practical'],
      writingStyle: {
        tone: 'Direct and no-nonsense',
        structure: 'Clear frameworks, actionable',
        strengths: ['Leadership', 'Organization', 'Clarity'],
        tendencies: ['May seem inflexible', 'Too structured']
      },
      socialMediaTips: 'Share systems that work. Lead by example.'
    },
    ESFJ: {
      name: 'The Consul',
      traits: ['Caring', 'Social', 'Loyal', 'Sensitive'],
      writingStyle: {
        tone: 'Friendly and inclusive',
        structure: 'Community-oriented, relatable',
        strengths: ['Building rapport', 'Practical help', 'Warmth'],
        tendencies: ['May seek approval', 'Avoid controversy']
      },
      socialMediaTips: 'Create community. Celebrate connections.'
    },
    ISTP: {
      name: 'The Virtuoso',
      traits: ['Bold', 'Practical', 'Experimental', 'Reserved'],
      writingStyle: {
        tone: 'Concise and action-oriented',
        structure: 'How-to, hands-on',
        strengths: ['Technical skill', 'Practical demos', 'Efficiency'],
        tendencies: ['May skip context', 'Too brief']
      },
      socialMediaTips: 'Show don\'t tell. Share builds and experiments.'
    },
    ISFP: {
      name: 'The Adventurer',
      traits: ['Charming', 'Sensitive', 'Artistic', 'Curious'],
      writingStyle: {
        tone: 'Authentic and artistic',
        structure: 'Visual, experiential',
        strengths: ['Aesthetic sense', 'Authenticity', 'In-the-moment'],
        tendencies: ['May seem unpredictable', 'Emotion-driven']
      },
      socialMediaTips: 'Share experiences. Lead with visuals.'
    },
    ESTP: {
      name: 'The Entrepreneur',
      traits: ['Energetic', 'Perceptive', 'Sociable', 'Pragmatic'],
      writingStyle: {
        tone: 'Bold and action-oriented',
        structure: 'Fast-paced, results-focused',
        strengths: ['High energy', 'Practical wins', 'Directness'],
        tendencies: ['May be too impulsive', 'Skip nuance']
      },
      socialMediaTips: 'Share wins fast. Move quickly.'
    },
    ESFP: {
      name: 'The Entertainer',
      traits: ['Spontaneous', 'Energetic', 'Friendly', 'Playful'],
      writingStyle: {
        tone: 'Fun and engaging',
        structure: 'Entertaining, lighthearted',
        strengths: ['Entertainment', 'Relatability', 'Energy'],
        tendencies: ['May lack depth', 'Too casual']
      },
      socialMediaTips: 'Entertain and engage. Have fun with it.'
    }
  };

  // Platform-specific masks
  PLATFORM_MASKS = {
    twitter: {
      name: 'Twitter/X',
      defaults: {
        formality: 0.3,
        humor: 0.6,
        emojiUse: 0.4,
        hashtagStyle: 'minimal',
        threadStyle: 'punchy',
        engagement: 'provocative'
      },
      tips: [
        'Keep it punchy - every word counts',
        'Threads for depth, single tweets for impact',
        'Quote tweets add your perspective',
        'Hot takes get engagement, but pick battles wisely'
      ]
    },
    linkedin: {
      name: 'LinkedIn',
      defaults: {
        formality: 0.7,
        humor: 0.3,
        emojiUse: 0.2,
        hashtagStyle: 'moderate',
        threadStyle: 'story',
        engagement: 'supportive'
      },
      tips: [
        'Hook in the first line - it shows above the fold',
        'Professional but personal stories work best',
        'Celebrate others\' wins generously',
        'Avoid humble brags - be genuinely helpful'
      ]
    },
    threads: {
      name: 'Threads',
      defaults: {
        formality: 0.3,
        humor: 0.5,
        emojiUse: 0.5,
        hashtagStyle: 'minimal',
        threadStyle: 'conversational',
        engagement: 'supportive'
      },
      tips: [
        'More Instagram-adjacent, visual-friendly',
        'Conversational tone works well',
        'Community feel - less competitive than Twitter',
        'Good for behind-the-scenes content'
      ]
    },
    instagram: {
      name: 'Instagram',
      defaults: {
        formality: 0.2,
        humor: 0.5,
        emojiUse: 0.7,
        hashtagStyle: 'heavy',
        threadStyle: 'story',
        engagement: 'supportive'
      },
      tips: [
        'Visual first - caption supports the image',
        'Longer captions perform well for engagement',
        'Hashtags in comments or at end',
        'Stories for casual, Feed for polished'
      ]
    }
  };

  /**
   * Calculate MBTI type from answers
   */
  calculateMBTI(answers) {
    const scores = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };

    for (const [questionId, answer] of Object.entries(answers)) {
      scores[answer] = (scores[answer] || 0) + 1;
    }

    const type = [
      scores.E >= scores.I ? 'E' : 'I',
      scores.S >= scores.N ? 'S' : 'N',
      scores.T >= scores.F ? 'T' : 'F',
      scores.J >= scores.P ? 'J' : 'P'
    ].join('');

    const confidence = {
      E_I: Math.abs(scores.E - scores.I) / 4,
      S_N: Math.abs(scores.S - scores.N) / 4,
      T_F: Math.abs(scores.T - scores.F) / 4,
      J_P: Math.abs(scores.J - scores.P) / 4
    };

    return { type, scores, confidence };
  }

  /**
   * Generate root persona from MBTI
   */
  generateRootPersona(mbtiType, additionalInfo = {}) {
    const profile = this.MBTI_PROFILES[mbtiType];
    if (!profile) {
      throw new Error(`Unknown MBTI type: ${mbtiType}`);
    }

    return {
      mbtiType,
      name: additionalInfo.name || 'Anonymous',
      profile: {
        name: profile.name,
        traits: profile.traits,
        writingStyle: profile.writingStyle,
        socialMediaTips: profile.socialMediaTips
      },
      coreTraits: profile.traits,
      writingStyle: profile.writingStyle,
      interests: additionalInfo.interests || [],
      expertise: additionalInfo.expertise || [],
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Generate platform mask based on root persona
   */
  generatePlatformMask(rootPersona, platform, customizations = {}) {
    const platformDefaults = this.PLATFORM_MASKS[platform];
    if (!platformDefaults) {
      throw new Error(`Unknown platform: ${platform}`);
    }

    const mbtiAdjustments = this.getMBTIAdjustments(rootPersona.mbtiType, platform);

    return {
      platform,
      ...platformDefaults.defaults,
      ...mbtiAdjustments,
      ...customizations,
      tips: platformDefaults.tips
    };
  }

  /**
   * Get MBTI-specific adjustments for platform
   */
  getMBTIAdjustments(mbtiType, platform) {
    const adjustments = {};

    if (mbtiType.startsWith('I')) {
      adjustments.formality = (adjustments.formality || 0.5) + 0.1;
      adjustments.engagement = 'informative';
    }

    if (mbtiType.includes('T')) {
      adjustments.humor = Math.max(0.2, (adjustments.humor || 0.5) - 0.1);
      adjustments.emojiUse = Math.max(0.1, (adjustments.emojiUse || 0.5) - 0.2);
    } else {
      adjustments.emojiUse = Math.min(0.8, (adjustments.emojiUse || 0.5) + 0.1);
    }

    if (mbtiType.includes('N')) {
      adjustments.threadStyle = platform === 'twitter' ? 'punchy' : 'story';
    }

    return adjustments;
  }

  /**
   * Generate system prompt from persona + mask
   */
  generateSystemPrompt(rootPersona, mask) {
    const profile = rootPersona.profile;

    let prompt = `You are writing social media content as someone with these characteristics:

## Core Personality (${rootPersona.mbtiType} - ${profile.name})
- Traits: ${profile.traits.join(', ')}
- Tone: ${profile.writingStyle.tone}
- Structure: ${profile.writingStyle.structure}
- Strengths: ${profile.writingStyle.strengths.join(', ')}

## Platform: ${mask.platform.toUpperCase()}
- Formality level: ${Math.round(mask.formality * 100)}% (0=casual, 100=formal)
- Humor level: ${Math.round(mask.humor * 100)}%
- Emoji usage: ${mask.emojiUse > 0.5 ? 'Liberal' : mask.emojiUse > 0.2 ? 'Moderate' : 'Minimal'}
- Hashtag style: ${mask.hashtagStyle}
- Engagement approach: ${mask.engagement}

## Writing Guidelines
${profile.socialMediaTips}

${mask.tips.map(tip => `- ${tip}`).join('\n')}`;

    if (rootPersona.interests && rootPersona.interests.length > 0) {
      prompt += `\n\n## Interests & References
You may reference: ${rootPersona.interests.join(', ')}`;
    }

    if (rootPersona.expertise && rootPersona.expertise.length > 0) {
      prompt += `\n\n## Areas of Expertise
${rootPersona.expertise.join(', ')}`;
    }

    // Add critical output instruction
    prompt += `\n\n## CRITICAL OUTPUT RULES
- Output ONLY the final post content, nothing else
- NO explanations, NO options, NO markdown formatting
- NO "Here are some options" or similar preambles
- Just write ONE ready-to-post message directly
- Keep it under 280 characters for Twitter
- Write in the same language as the user's prompt`;

    return prompt;
  }

  /**
   * Save persona to disk
   */
  save(persona) {
    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(persona, null, 2));
      console.log('[PersonaBuilder] Persona saved');
      return true;
    } catch (error) {
      console.error('[PersonaBuilder] Failed to save persona:', error);
      return false;
    }
  }

  /**
   * Load persona from disk
   */
  load() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = fs.readFileSync(this.dataPath, 'utf8');
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error('[PersonaBuilder] Failed to load persona:', error);
      return null;
    }
  }

  /**
   * Check if persona exists
   */
  exists() {
    const persona = this.load();
    return persona !== null && persona.rootPersona !== undefined;
  }

  /**
   * Create full persona with masks
   */
  createFullPersona(mbtiAnswers, additionalInfo = {}) {
    const mbtiResult = this.calculateMBTI(mbtiAnswers);
    const rootPersona = this.generateRootPersona(mbtiResult.type, additionalInfo);

    const masks = {};
    for (const platform of Object.keys(this.PLATFORM_MASKS)) {
      masks[platform] = this.generatePlatformMask(rootPersona, platform);
    }

    const fullPersona = {
      rootPersona,
      mbtiResult,
      masks,
      createdAt: new Date().toISOString(),
      version: '1.0'
    };

    this.save(fullPersona);
    return fullPersona;
  }

  /**
   * Update mask customizations
   */
  updateMask(platform, customizations) {
    const persona = this.load();
    if (!persona) {
      throw new Error('No persona found');
    }

    persona.masks[platform] = {
      ...persona.masks[platform],
      ...customizations
    };

    this.save(persona);
    return persona.masks[platform];
  }

  /**
   * Get prompt for specific platform
   */
  getPromptForPlatform(platform) {
    const persona = this.load();
    if (!persona) {
      return null;
    }

    const mask = persona.masks[platform] || persona.masks.twitter;
    return this.generateSystemPrompt(persona.rootPersona, mask);
  }

  /**
   * Get MBTI questions
   */
  getQuestions() {
    return this.MBTI_QUESTIONS;
  }

  /**
   * Delete persona
   */
  delete() {
    try {
      if (fs.existsSync(this.dataPath)) {
        fs.unlinkSync(this.dataPath);
        console.log('[PersonaBuilder] Persona deleted');
      }
      return true;
    } catch (error) {
      console.error('[PersonaBuilder] Failed to delete persona:', error);
      return false;
    }
  }
}

module.exports = new PersonaBuilder();
