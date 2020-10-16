declare module NodeJS {
    interface Global {
        reconnect: () => Promise<void>;
    }
}