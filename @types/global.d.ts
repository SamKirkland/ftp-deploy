// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface global { }
declare global {
    function reconnect(): Promise<void>;
}