/*
 * SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: LicenseRef-NvidiaProprietary
 *
 * NVIDIA CORPORATION, its affiliates and licensors retain all intellectual
 * property and proprietary rights in and to this material, related
 * documentation and any modifications thereto. Any use, reproduction,
 * disclosure or distribution of this material and related documentation
 * without an express license agreement from NVIDIA CORPORATION or
 * its affiliates is strictly prohibited.
 */

import { Component } from 'react';
import { getApplications, getApplicationVersions, getApplicationVersionProfiles } from './Endpoints';

const nextButtonStyle = {
    width: '200px',
    margin: '20px 15px 0px 0px',
};

const formContainerStyle = {
    margin: '20px 20px',
}

export interface Application {
    id: string
    name: string
    version?: string
    profile?: string
}

interface AppOnlyProps {
    onNext: (state: any) => void;
}

interface AppOnlyState {
    useWebUI: boolean;
}

interface ServerURLsProps {
    onBack: (appServer: string, streamServer: string) => void;
    onNext: (appServer: string, streamServer: string, applications: Application[]) => void;
    appServer: string
    streamServer: string
}

interface ServerURLsState {
    applications: Application[];
    appServer: string,
    streamServer: string
}

interface ApplicationsProps {
    onBack: () => void;
    onNext: (applicationId: string, versions: string[]) => void;
    appServer: string,
    applications: Application[];
}

interface ApplicationsState {
    versions: string[];
    selectedApplication: Application;
}

interface VersionsProps {
    onBack: () => void;
    onNext: (selectedVersion: string, profiles: string[]) => void;
    appServer: string;
    applicationId: string;
    versions: string[];
}

interface VersionsState {
    profiles: string[];
    selectedVersion: string;
}

interface ProfilesProps {
    onBack: () => void;
    onNext: (applicationProfile: string) => void;
    profiles: string[];
}

interface ProfilesState {
    selectedProfile: string;
}


/**
 * Form for selecting if only the Kit application stream will load or if UI controls will be included.
 */
export class AppOnlyForm extends Component <AppOnlyProps, AppOnlyState>{
    constructor(props: AppOnlyProps) {
        super(props);

        this.state = {
            useWebUI: true
        }
    }
    
    private _handleOptionChange(value: boolean): void {
        this.setState({ useWebUI: value } );
    };

    render () {
        return (
            
            <div style={formContainerStyle}>
            <h3>UI 顯示模式</h3>
                <label>這個 client 對應 NVIDIA <a
                    href="https://docs.omniverse.nvidia.com/embedded-web-viewer/latest/index.html" target="_blank"
                    rel="noopener noreferrer">Embedded Web Viewer Guide</a>，
                    並提供可操作 <b>USD Viewer</b> template Kit app 的 UI 與功能；template 來源是
                    <a href="https://github.com/NVIDIA-Omniverse/kit-app-template"
                                              target="_blank" rel="noopener noreferrer"> kit-app-template</a>。
                    <br/>
                    如果串流的是其他 Kit app，請選第二個選項，避免 viewer UI 擋住串流畫面。
                </label>
                <br/>
            <br/>
            <div className="form-check">
                <input className="form-check-input" type="radio" name="webUiRadio" checked={this.state.useWebUI} id="yes" onChange={() => this._handleOptionChange(true)}/>
                <label className="form-check-label" htmlFor="radios1">
                    顯示 <b>USD Viewer</b> 專用 UI 與 BIM review Demo 面板
                </label>
            </div>
            <div className="form-check">
                <input className="form-check-input" type="radio" name="webUiRadio" id="no" checked={!this.state.useWebUI} onChange={() => this._handleOptionChange(false)}/>
                <label className="form-check-label" htmlFor="radios1">
                    只顯示 <b>任意 Kit app</b> 串流畫面
                </label>
            </div>
            <button type="button" className="nvidia-button" onClick={() => this.props.onNext(this.state)} style={nextButtonStyle}>下一步</button>
        </div>
        )
    }
}

/**
* Form that contains the URLs for streaming
*
* @class ServerURLsForm
*/
export class ServerURLsForm extends Component <ServerURLsProps, ServerURLsState> {
    constructor(props: ServerURLsProps) {
        super(props);

        this.state = {
            appServer: this.props.appServer,
            streamServer: this.props.streamServer,
            applications: []
        };
    }

    private _onBack(): void {
        let appServer = (document.getElementById("app-server") as HTMLInputElement).value;
        let streamServer = (document.getElementById("stream-server") as HTMLInputElement).value;
        this.setState({ appServer: appServer, streamServer: streamServer })
        this.props.onBack(appServer, streamServer)
    }

    /**
     * Validation procedure for user-entered endpoints
     * 
     * @param endpoint - The endpoint URL
     * @returns true if validation succeeded, otherwise false
     */
    async _validateEndpoint(endpoint: string): Promise<boolean> {
        try {
            const response = await fetch(endpoint, {
            method: 'GET',
            mode: 'cors',
            headers: {'Content-Type': 'application/json'},
            });
    
            if (!response.ok) {
                alert(`錯誤：endpoint 回傳狀態碼 ${response.status}`);
                return false
            }
        }
        
        catch (error) {
            alert(`錯誤：無法連線到 endpoint \`${endpoint}\``);
            return false
        }

        return true
    }

    /**
     * Executes when the 'next' button is clicked.
     */
    async _onNext() {
        let appServer = (document.getElementById("app-server") as HTMLInputElement).value;
        
        // validate app server URL value is entered
        if (appServer.length === 0) {
            alert("請輸入 App Server。")
            return
        }

        // validate app server URL formatting
        try {
            new URL(appServer);
        }
        catch (err) {
            alert(`App Server URL 格式不正確`);
            return;
        }
        
        // validate connection can be made to app server
        if  (!await this._validateEndpoint(`${appServer}/cfg/apps`)) return
        
        let streamServer = (document.getElementById("stream-server") as HTMLInputElement).value;
        if (streamServer.length === 0) {
            alert("請輸入 Stream Server。")
            return
        }
        
        // validate stream server URL formatting
        try {
            new URL(streamServer);
        }
        catch (err) {
            alert(`Stream Server URL 格式不正確`);
            return;
        }

        // validate connection can be made to stream server
        if  (!await this._validateEndpoint(`${streamServer}/streaming/stream`)) return

        await this._loadApplications(appServer)
        
        // validate that applications exist
        this.setState((prevState) => {
            if (prevState.applications.length === 0) {
                alert(`App Server \`${appServer}\` 沒有回傳可用 application`)
            }
            else {
                this.props.onNext(appServer, streamServer, prevState.applications)
            }
        });

    }

    private _loadApplications = async (appServer: string) => {
        const response = await getApplications(appServer);
        if (response.status === 200) {
            console.log(response.data)
            this.setState(prevState => ({ ...prevState, applications: Object.values(response.data) }));
        }
    };

    render() {
        
        return (
            <div style={formContainerStyle}>
                <h3>Server 連線資訊</h3>
                <div className="mb-3">
                <div className="row align-items-center">

                <div className="container">
                <div className="row align-items-center mb-3">
                    <div className="col-auto">
                    <label htmlFor="input1" className="col-form-label">App Server</label>
                    </div>
                    <div className="col">
                        <input type="text" className="form-control" id="app-server" placeholder="輸入 App Server URL" defaultValue={this.state.appServer} style={{outline:"2px solid #76b900"}} />
                    </div>
                </div>

                <div className="row align-items-center">
                    <div className="col-auto">
                    <label htmlFor="input2" className="col-form-label">Stream Server</label>
                    </div>
                    <div className="col">
                    <input type="text" className="form-control" id="stream-server" placeholder="輸入 Stream Server URL" defaultValue={this.state.streamServer}  style={{outline:"2px solid #76b900"}} />
                    </div>
                </div>
                </div>
                
                </div>
                    <button type="button" className="nvidia-button" onClick={() => this._onBack()} style={nextButtonStyle}>上一步</button>
                    <button type="button" className="nvidia-button" onClick={() => this._onNext()} style={nextButtonStyle}>下一步</button>
                </div>
        </div>
    )
    }
}

/**
* Form that allows a user to select an application
*
* @class ApplicationsForm
*/
export class ApplicationsForm extends Component <ApplicationsProps, ApplicationsState> {
    constructor(props: ApplicationsProps) {
        super(props);

        this.state = {
            selectedApplication: this.props.applications[0],
            versions: []
        };
    }

    /**
     * Executes when the 'next' button is clicked.
     */
    async _onNext() {
        const selectedAppId: string = this.state.selectedApplication.id

        await this._loadVersions(this.props.appServer, selectedAppId)
        this.setState((prevState) => {
            if (prevState.versions.length === 0) {
                alert(`Application id ${selectedAppId} 沒有可用版本`)
                return
                
            }
            else {
                this.props.onNext(prevState.selectedApplication.id, prevState.versions)
            }
        });
    }
    
    /**
     * Queries available application versions for the provided app server and app id
     * 
     * @param appServer - The app server URL
     * @param appId - The application id
     */
    private _loadVersions = async (appServer: string, appId: string) => {
        const response = await getApplicationVersions(appServer, appId);
        if (response.status === 200) {
            this.setState(prevState => ({ ...prevState, versions: response.data.versions}));
        }
    };
    
    /**
     * Executes when a user selects an application item from the dropdown
     */
    handleSelectChange = (event: any) => {
        const selectedAppId = event.target.value;
        const selectedApplication = this.props.applications.find((app) => app.id === selectedAppId);

        if (!selectedApplication)
            throw new Error(`Application with id ${selectedAppId} not found`);

        this.setState({ selectedApplication: selectedApplication });
    };

    render() {
        return (
            <div style={formContainerStyle}>
                <h3>選擇 Kit application</h3>
                <div className="mb-3">
                    <select
                        className="nvidia-dropdown"
                        id="exampleSelect"
                        value={this.state.selectedApplication.id} 
                        onChange={this.handleSelectChange}
                    >
                            {this.props.applications.map((app) => (
                        <option key={app.id} value={app.id} className="nvidia-dropdown-option">
                            {app.id}
                        </option>
                        ))}
                        </select>
                </div>
                    <button type="button" className="nvidia-button" onClick={() => this.props.onBack()} style={nextButtonStyle}>上一步</button>
                    <button type="button" className="nvidia-button" onClick={() => this._onNext()} style={nextButtonStyle}>下一步</button>
                </div>
            )
    }
}

/**
* Form that allows a user to select an application version
*
* @class VersionsForm
*/
export class VersionsForm extends Component <VersionsProps, VersionsState> {
    constructor(props: VersionsProps) {
        super(props);

        this.state = {
            selectedVersion: this.props.versions[0],
            profiles: []
        };
    }

    /**
     * Executes when the 'next' button is clicked.
     */
    async _onNext() {
        const selectedVersion: string = this.state.selectedVersion

        await this._loadProfiles(this.props.applicationId, selectedVersion)

        this.setState((prevState) => {
            if (prevState.profiles.length === 0) {
                alert(`Application version ${selectedVersion} 沒有可用 profile`)
                return
                
            }
            else {
                this.props.onNext(prevState.selectedVersion, prevState.profiles)
            }
        });
    }

    /**
     * Queries available profiles versions for the provided app id and version
     * 
     * @param appServer - The app server URL
     * @param appId - The application id
     */
    private _loadProfiles = async (appId: string, version: string) => {
        const response = await getApplicationVersionProfiles(this.props.appServer, appId, version);
        if (response.status === 200) {
            this.setState(prevState => ({ ...prevState, profiles: response.data.profiles.map(p => p.id)}));
        }
    };

    /**
     * Executes when a user selects a version item from the dropdown
     */
    handleSelectChange = (event: any) => {
        const selectedVersion = event.target.value;
        this.setState({ selectedVersion: selectedVersion });
    };


    render() {
        return (
            <div style={formContainerStyle}>
                <h3>選擇版本</h3>
                <div className="mb-3">
                    <select
                        className="nvidia-dropdown"
                        id="exampleSelect"
                        value={this.state.selectedVersion} 
                        onChange={this.handleSelectChange}
                    >
                            {this.props.versions.map((version) => (
                        <option key={version} value={version} className="nvidia-dropdown-option">
                            {version}
                        </option>
                        ))}
                        </select>
                </div>      
                    <button type="button" className="nvidia-button" onClick={() => this.props.onBack() } style={nextButtonStyle}>上一步</button>
                    <button type="button" className="nvidia-button" onClick={() => this._onNext()} style={nextButtonStyle}>下一步</button>
                </div>
      
            )
    }
}

/**
* Form that allows a user to select an application profile
*
* @class ProfilesForm
*/
export class ProfilesForm extends Component <ProfilesProps, ProfilesState> {
    constructor(props: ProfilesProps) {
        super(props);

        this.state = {
            selectedProfile: this.props.profiles[0]
        };
    }

    /**
     * Executes when the 'next' button is clicked.
     */
    async _onNext() {
        this.props.onNext(this.state.selectedProfile)
    }

    /**
     * Executes when a user selects a profile item from the dropdown
     */
    handleSelectChange = (event: any) => {
        const selectedProfile = event.target.value;
        this.setState({ selectedProfile: selectedProfile });
        
    };

    render() {
        return (
            <div style={formContainerStyle}>
                <h3>選擇 profile</h3>
                <div className="mb-3">
                    <select
                        className="nvidia-dropdown"
                        id="profileSelect"
                        value={this.state.selectedProfile} 
                        onChange={this.handleSelectChange}
                    >
                            {this.props.profiles.map((profile) => (
                        <option key={profile} value={profile} className="nvidia-dropdown-option">
                            {profile}
                        </option>
                        ))}
                        </select>
                </div>
                    <button type="button" className="nvidia-button" onClick={() => this.props.onBack()} style={nextButtonStyle}>上一步</button>
                    <button type="button" className="nvidia-button" onClick={() => this._onNext()} style={nextButtonStyle}>下一步</button>
                </div>
      
            )
    }
}
