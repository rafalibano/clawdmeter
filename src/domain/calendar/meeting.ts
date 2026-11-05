export type ShowAs = 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown';

export interface Meeting {
  id: string;
  title: string;
  startsAt: number;
  endsAt: number;
  allDay: boolean;
  cancelled: boolean;
  showAs: ShowAs;
  organizer: string | null;
  location: string | null;
  joinUrl: string | null;
}

const SHOW_AS: readonly ShowAs[] = ['free', 'tentative', 'busy', 'oof', 'workingElsewhere', 'unknown'];

export function parseShowAs(value: unknown): ShowAs {
  return typeof value === 'string' && (SHOW_AS as readonly string[]).includes(value) ? (value as ShowAs) : 'unknown';
}
