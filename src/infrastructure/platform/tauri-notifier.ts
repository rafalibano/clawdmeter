import { sendNotification } from '@tauri-apps/plugin-notification';
import type { Notice, Notifier } from '../../application/ports';

export interface NotifyApi {
  send(notice: Notice): void;
}

const pluginApi: NotifyApi = { send: (notice) => sendNotification({ title: notice.title, body: notice.body }) };

export class TauriNotifier implements Notifier {
  constructor(private readonly api: NotifyApi = pluginApi) {}

  async notify(notice: Notice): Promise<void> {
    this.api.send(notice);
  }
}
