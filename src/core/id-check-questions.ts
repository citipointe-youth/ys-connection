// ID check question bank (spec 2026-10-30 section 9). Keys are permanent: re-wording keeps the key, a new question takes the
// next number, a dropped question stays with retired: true. Never renumber or reuse a key.
export type IdCheckQuestion = { key: string; text: string; retired?: true };
export type IdCheckSection = { key: 'faith' | 'form' | 'family' | 'finances' | 'fruit' | 'general'; title: string; subtitle: string; questions: IdCheckQuestion[] };

type S = IdCheckSection['key'];
const sec = (key: S, title: string, subtitle: string, texts: string[]): IdCheckSection => ({
  key, title, subtitle,
  questions: texts.map((text, i) => ({ key: `${key}${String(i + 1).padStart(2, '0')}`, text })),
});

export const ID_CHECK_SECTIONS: readonly IdCheckSection[] = [
  sec('faith', 'FAITH', 'their walk with God', [
    "How's your relationship with God?",
    'What does spending time with God look like?',
    'What are you reading in the bible?',
    'When do you usually pray? What do you pray for?',
    "What's God been doing in your life lately?",
    "What's God been challenging you on?",
    'What are your convictions?',
    'What do you have faith for?',
    'What are your God dreams?',
    'Who do you look up to?',
  ]),
  sec('form', 'FORM', 'their character development', [
    "How's your heart?",
    "How's your mind/thoughts?",
    "How's your soul?",
    "How's your attitude?",
    'Do you think that ___ is beneficial? What do you think about that?',
    "What does God's word say about that? How does that align with God's word?",
    'Are you good with conflict? Having hard conversations?',
    'Do you have any questions you would like to ask?',
    'Is there something you are trying to work on in your character at the moment?',
    'What area do you want to grow in?',
    'What kind of person do you want to be? Leader?',
  ]),
  sec('family', 'FAMILY/FRIENDS', 'their relationships with family & friends', [
    'What was it like growing up in your family?',
    "What's your family dynamic like?",
    'How did it affect you? Does it still affect you?',
    "What's your relationship with your ___ like?",
    'Who are your people? Who are your friends?',
    'Who speaks into your life? Who challenges you?',
    'Are there any relationships you wish to be restored?',
    'Is there anyone in your life you have unforgiveness towards?',
    'What kind of husband/wife do you want to be? (if applicable)',
    'Do you dream of having a family one day? What kind of family?',
  ]),
  sec('finances', 'FINANCES', "their stewardship of what God has entrusted us to", [
    'Do you have any finance goals? Saving up for? Working towards?',
    'What was the relationship like with money and finances growing up?',
    "What's your understanding of tithing and giving?",
    'Do you find it easy to be generous?',
    'Do you believe God will provide for you financially?',
    "What's an area of your finances that you want to grow in?",
    'Is this an area that you struggle in?',
    "What's your mindset with money?",
    'Do you think you steward your finances well?',
    'What are you believing for?',
  ]),
  sec('fruit', 'FRUIT', 'the effectiveness of their ministry', [
    'How do you serve God in your life?',
    'Do you enjoy serving in church?',
    "Do you have a conviction about building God's kingdom?",
    'What does that look like?',
    'Are the fruits of the spirit produced in your life? (love, peace, joy, kindness, faithfulness, patience, gentleness, goodness, self control)',
    'What passions are in your heart?',
    "What frustrates you ministry wise? What's an area in ministry you care about?",
    'What are you doing to develop your skills etc?',
    "What's your God dream?",
  ]),
  sec('general', 'GENERAL', '', [
    'What do you do for fun?',
    'What gets you excited for life?',
    'What was your childhood like?',
    "What's your story?",
    'Do you find 1 on 1 convos hard?',
    'Is there anything I can pray for specifically?',
    "Is there anything specific you'd like to talk about?",
    'How can I support you better?',
    'How do you best feel loved? Love language?',
    "What's something you'd like accountability for?",
    "Is there something about your faith you'd like to learn more about?",
    'Do you have any questions?',
  ]),
];

/** Every question key, retired included. */
export const ID_CHECK_KEYS: ReadonlySet<string> = new Set(ID_CHECK_SECTIONS.flatMap((s) => s.questions.map((q) => q.key)));
