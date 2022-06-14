"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorCode = exports.syncFileDescription = exports.currentSyncFileVersion = void 0;
exports.currentSyncFileVersion = "1.0.0";
exports.syncFileDescription = "DO NOT DELETE THIS FILE. This file is used to keep track of which files have been synced in the most recent deployment. If you delete this file a resync will need to be done (which can take a while) - read more: https://github.com/SamKirkland/FTP-Deploy-Action";
var ErrorCode;
(function (ErrorCode) {
    // The requested action is being initiated, expect another reply before proceeding with a new command.
    ErrorCode[ErrorCode["RestartMarkerReplay"] = 110] = "RestartMarkerReplay";
    ErrorCode[ErrorCode["ServiceReadyInNNNMinutes"] = 120] = "ServiceReadyInNNNMinutes";
    ErrorCode[ErrorCode["DataConnectionAlreadyOpenStartingTransfer"] = 125] = "DataConnectionAlreadyOpenStartingTransfer";
    ErrorCode[ErrorCode["FileStatusOkayOpeningDataConnection"] = 150] = "FileStatusOkayOpeningDataConnection";
    // The requested action has been successfully completed.
    ErrorCode[ErrorCode["CommandNotImplemented"] = 202] = "CommandNotImplemented";
    ErrorCode[ErrorCode["SystemStatus"] = 211] = "SystemStatus";
    ErrorCode[ErrorCode["DirectoryStatus"] = 212] = "DirectoryStatus";
    ErrorCode[ErrorCode["FileStatus"] = 213] = "FileStatus";
    ErrorCode[ErrorCode["HelpMessage"] = 214] = "HelpMessage";
    ErrorCode[ErrorCode["IANAOfficialName"] = 215] = "IANAOfficialName";
    ErrorCode[ErrorCode["ReadyForNewUser"] = 220] = "ReadyForNewUser";
    ErrorCode[ErrorCode["ClosingControlConnection"] = 221] = "ClosingControlConnection";
    ErrorCode[ErrorCode["DataConnectionOpen"] = 225] = "DataConnectionOpen";
    ErrorCode[ErrorCode["SuccessNowClosingDataConnection"] = 226] = "SuccessNowClosingDataConnection";
    ErrorCode[ErrorCode["EnteringPassiveMode"] = 227] = "EnteringPassiveMode";
    ErrorCode[ErrorCode["EnteringLongPassiveMode"] = 228] = "EnteringLongPassiveMode";
    ErrorCode[ErrorCode["EnteringExtendedPassiveMode"] = 229] = "EnteringExtendedPassiveMode";
    ErrorCode[ErrorCode["UserLoggedIn"] = 230] = "UserLoggedIn";
    ErrorCode[ErrorCode["UserLoggedOut"] = 231] = "UserLoggedOut";
    ErrorCode[ErrorCode["LogoutWillCompleteWhenTransferDone"] = 232] = "LogoutWillCompleteWhenTransferDone";
    ErrorCode[ErrorCode["ServerAcceptsAuthenticationMethod"] = 234] = "ServerAcceptsAuthenticationMethod";
    ErrorCode[ErrorCode["ActionComplete"] = 250] = "ActionComplete";
    ErrorCode[ErrorCode["PathNameCreated"] = 257] = "PathNameCreated";
    // The command has been accepted, but the requested action is on hold, pending receipt of further information.
    ErrorCode[ErrorCode["UsernameOkayPasswordNeeded"] = 331] = "UsernameOkayPasswordNeeded";
    ErrorCode[ErrorCode["NeedAccountForLogin"] = 332] = "NeedAccountForLogin";
    ErrorCode[ErrorCode["RequestedFileActionPendingFurtherInformation"] = 350] = "RequestedFileActionPendingFurtherInformation";
    // The command was not accepted and the requested action did not take place, but the error condition is temporary and the action may be requested again.
    ErrorCode[ErrorCode["ServiceNotAvailable"] = 421] = "ServiceNotAvailable";
    ErrorCode[ErrorCode["CantOpenDataConnection"] = 425] = "CantOpenDataConnection";
    ErrorCode[ErrorCode["ConnectionClosed"] = 426] = "ConnectionClosed";
    ErrorCode[ErrorCode["InvalidUsernameOrPassword"] = 430] = "InvalidUsernameOrPassword";
    ErrorCode[ErrorCode["HostUnavailable"] = 434] = "HostUnavailable";
    ErrorCode[ErrorCode["FileActionNotTaken"] = 450] = "FileActionNotTaken";
    ErrorCode[ErrorCode["LocalErrorProcessing"] = 451] = "LocalErrorProcessing";
    ErrorCode[ErrorCode["InsufficientStorageSpaceOrFileInUse"] = 452] = "InsufficientStorageSpaceOrFileInUse";
    // Syntax error, command unrecognized and the requested action did not take place. This may include errors such as command line too long.
    ErrorCode[ErrorCode["SyntaxErrorInParameters"] = 501] = "SyntaxErrorInParameters";
    ErrorCode[ErrorCode["CommandNotImpemented"] = 502] = "CommandNotImpemented";
    ErrorCode[ErrorCode["BadSequenceOfCommands"] = 503] = "BadSequenceOfCommands";
    ErrorCode[ErrorCode["CommandNotImplementedForThatParameter"] = 504] = "CommandNotImplementedForThatParameter";
    ErrorCode[ErrorCode["NotLoggedIn"] = 530] = "NotLoggedIn";
    ErrorCode[ErrorCode["NeedAccountForStoringFiles"] = 532] = "NeedAccountForStoringFiles";
    ErrorCode[ErrorCode["CouldNotConnectToServerRequiresSSL"] = 534] = "CouldNotConnectToServerRequiresSSL";
    ErrorCode[ErrorCode["FileNotFoundOrNoAccess"] = 550] = "FileNotFoundOrNoAccess";
    ErrorCode[ErrorCode["UnknownPageType"] = 551] = "UnknownPageType";
    ErrorCode[ErrorCode["ExceededStorageAllocation"] = 552] = "ExceededStorageAllocation";
    ErrorCode[ErrorCode["FileNameNotAllowed"] = 553] = "FileNameNotAllowed";
    // Replies regarding confidentiality and integrity
    ErrorCode[ErrorCode["IntegrityProtectedReply"] = 631] = "IntegrityProtectedReply";
    ErrorCode[ErrorCode["ConfidentialityAndIntegrityProtectedReply"] = 632] = "ConfidentialityAndIntegrityProtectedReply";
    ErrorCode[ErrorCode["ConfidentialityProtectedReply"] = 633] = "ConfidentialityProtectedReply";
    // Common Winsock Error Codes[2] (These are not FTP return codes)
    ErrorCode[ErrorCode["ConnectionClosedByServer"] = 10054] = "ConnectionClosedByServer";
    ErrorCode[ErrorCode["CannotConnect"] = 10060] = "CannotConnect";
    ErrorCode[ErrorCode["CannotConnectRefusedByServer"] = 10061] = "CannotConnectRefusedByServer";
    ErrorCode[ErrorCode["DirectoryNotEmpty"] = 10066] = "DirectoryNotEmpty";
    ErrorCode[ErrorCode["TooManyUsers"] = 10068] = "TooManyUsers";
})(ErrorCode = exports.ErrorCode || (exports.ErrorCode = {}));
;
