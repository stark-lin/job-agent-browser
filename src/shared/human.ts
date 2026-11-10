export interface HumanAskInput { question: string; options?: string[] }
export type HumanAskResult = { status: 'submitted'; selectedOption: string | null; text: string } | { status: 'cancelled' }
export interface HumanRequest extends HumanAskInput { id: string }
