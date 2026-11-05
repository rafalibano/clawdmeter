export interface Notice {
  title: string;
  body: string;
}

export interface Notifier {
  notify(notice: Notice): Promise<void>;
}
