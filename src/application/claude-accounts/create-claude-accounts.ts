import {
  AddClaudeAccount,
  CancelClaudeLogin,
  ClaudeLogins,
  CompleteClaudeLoginWithCode,
  ListClaudeAccounts,
  OpenClaudeLoginCodePage,
  ReauthenticateClaudeAccount,
  RemoveClaudeAccount,
  RenameClaudeAccount,
  SelectClaudeAccount,
  SetClaudeClientId,
  type ClaudeAccountDeps,
} from '../use-cases/claude-accounts';

export interface ClaudeAccounts {
  list: ListClaudeAccounts;
  add: AddClaudeAccount;
  reauthenticate: ReauthenticateClaudeAccount;
  openCodePage: OpenClaudeLoginCodePage;
  completeWithCode: CompleteClaudeLoginWithCode;
  cancelLogin: CancelClaudeLogin;
  rename: RenameClaudeAccount;
  remove: RemoveClaudeAccount;
  select: SelectClaudeAccount;
  setClientId: SetClaudeClientId;
}

export function createClaudeAccounts(deps: ClaudeAccountDeps): ClaudeAccounts {
  const logins = new ClaudeLogins(deps);
  return {
    list: new ListClaudeAccounts(deps),
    add: new AddClaudeAccount(deps, logins),
    reauthenticate: new ReauthenticateClaudeAccount(deps, logins),
    openCodePage: new OpenClaudeLoginCodePage(logins),
    completeWithCode: new CompleteClaudeLoginWithCode(logins),
    cancelLogin: new CancelClaudeLogin(logins),
    rename: new RenameClaudeAccount(deps),
    remove: new RemoveClaudeAccount(deps),
    select: new SelectClaudeAccount(deps),
    setClientId: new SetClaudeClientId(deps),
  };
}
