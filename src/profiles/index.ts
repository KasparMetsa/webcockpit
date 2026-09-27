// Public surface of the profiles module (ADR 0010 "Profiles").
export * from './names';
export { PROFILE_TEMPLATE, ProfileError, type ProfileRecord, ProfileStore, compareNames } from './store';
export { downloadProfile } from './download';
