import { ILogger } from "./utilities";

export interface IFtpDeployArguments {
    server: string;
    username: string;
    password: string;
    "local-dir"?: string;
    "server-dir"?: string;
    "state-name"?: string;
    "dry-run"?: boolean;
    "dangerous-clean-slate"?: boolean;
    include?: string[];
    exclude?: string[];
    "log-level"?: string;
}

export interface IFile {
    type: "file";
    name: string;
    size: number;
    hash: string;
}

export interface IFolder {
    type: "folder";
    name: string;
    size: undefined;
}

export type Record = IFolder | IFile;

export interface IFileList {
    /** Give some info to people opening this file wondering what it is */
    description: string;

    /** version number of this diff file */
    version: "1.0.0";

    /** UTC time of the last publish start */
    generatedTime: number;
    data: Record[];
}

export const syncFileDescription = "DO NOT DELETE THIS FILE. This file is used to keep track of which files have been synced in the most recent deployment. If you delete this file a resync will need to be done (which can take a while) - read more: https://github.com/SamKirkland/FTP-Deploy-Action";

export type DiffResult = {
    upload: Record[];
    delete: Record[];
    replace: Record[];

    /** number of bytes that will need to be uploaded */
    sizeUpload: number;

    /** number of bytes that will need to be removed */
    sizeDelete: number;

    /** number of bytes that will need to be replaced */
    sizeReplace: number;
}

export interface IDiff {
    getDiffs(localFiles: IFileList, serverFiles: IFileList, logger: ILogger): DiffResult;
}

export interface IFilePath {
    /** will be null when no folders exist in path */
    folders: string[] | null;

    /** will be null when no file exists in path */
    file: string | null;
}

export enum ErrorCode {
    // The requested action is being initiated, expect another reply before proceeding with a new command.
    RestartMarkerReplay = 110,
    ServiceReadyInNNNMinutes = 120,
    DataConnectionAlreadyOpenStartingTransfer = 125,
    FileStatusOkayOpeningDataConnection = 150,

    // The requested action has been successfully completed.
    CommandNotImplemented = 202,
    SystemStatus = 211,
    DirectoryStatus = 212,
    FileStatus = 213,
    HelpMessage = 214,
    IANAOfficialName = 215,
    ReadyForNewUser = 220,
    ClosingControlConnection = 221,
    DataConnectionOpen = 225,
    SuccessNowClosingDataConnection = 226,
    EnteringPassiveMode = 227,
    EnteringLongPassiveMode = 228,
    EnteringExtendedPassiveMode = 229,
    UserLoggedIn = 230,
    UserLoggedOut = 231,
    LogoutWillCompleteWhenTransferDone = 232,
    ServerAcceptsAuthenticationMethod = 234,
    ActionComplete = 250,
    PathNameCreated = 257,

    // The command has been accepted, but the requested action is on hold, pending receipt of further information.
    UsernameOkayPasswordNeeded = 331,
    NeedAccountForLogin = 332,
    RequestedFileActionPendingFurtherInformation = 350,


    // The command was not accepted and the requested action did not take place, but the error condition is temporary and the action may be requested again.
    ServiceNotAvailable = 421,
    CantOpenDataConnection = 425,
    ConnectionClosed = 426,
    InvalidUsernameOrPassword = 430,
    HostUnavailable = 434,
    FileActionNotTaken = 450,
    LocalErrorProcessing = 451,
    InsufficientStorageSpaceOrFileInUse = 452,

    // Syntax error, command unrecognized and the requested action did not take place. This may include errors such as command line too long.
    SyntaxErrorInParameters = 501,
    CommandNotImpemented = 502,
    BadSequenceOfCommands = 503,
    CommandNotImplementedForThatParameter = 504,
    NotLoggedIn = 530,
    NeedAccountForStoringFiles = 532,
    CouldNotConnectToServerRequiresSSL = 534,
    FileNotFoundOrNoAccess = 550,
    UnknownPageType = 551,
    ExceededStorageAllocation = 552,
    FileNameNotAllowed = 553,

    // Replies regarding confidentiality and integrity
    IntegrityProtectedReply = 631,
    ConfidentialityAndIntegrityProtectedReply = 632,
    ConfidentialityProtectedReply = 633,


    // Common Winsock Error Codes[2] (These are not FTP return codes)
    ConnectionClosedByServer = 10054,
    CannotConnect = 10060,
    CannotConnectRefusedByServer = 10061,
    DirectoryNotEmpty = 10066,
    TooManyUsers = 10068,
};