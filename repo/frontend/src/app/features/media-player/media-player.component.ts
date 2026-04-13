import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, interval, timer } from 'rxjs';
import { takeUntil, debounceTime } from 'rxjs/operators';
import { ApiService, PaginatedResponse } from '../../core/services/api.service';

export const VOD_ERROR_CODES = {
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  SEGMENT_DECODE_FAIL: 'SEGMENT_DECODE_FAIL',
  MANIFEST_PARSE_ERROR: 'MANIFEST_PARSE_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export type VodErrorCode = typeof VOD_ERROR_CODES[keyof typeof VOD_ERROR_CODES];

const RETRY_DELAYS_MS = [2000, 5000, 10000] as const;
const MAX_RETRIES = RETRY_DELAYS_MS.length;

declare const Hls: {
  isSupported(): boolean;
  new(): HlsInstance;
  Events: { MANIFEST_PARSED: string; ERROR: string; LEVEL_SWITCHED: string };
  ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
};

interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(video: HTMLVideoElement): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  destroy(): void;
  levels: { height: number; width: number; bitrate: number }[];
  currentLevel: number;
}

declare const dashjs: {
  MediaPlayer(): { create(): DashPlayer };
};

interface DashPlayer {
  initialize(video: HTMLVideoElement, url: string, autoPlay: boolean): void;
  destroy(): void;
  getBitrateInfoListFor(type: string): { qualityIndex: number; height: number; bitrate: number }[];
  setQualityFor(type: string, quality: number): void;
  getQualityFor(type: string): number;
  on(event: string, callback: (...args: unknown[]) => void): void;
}

interface MediaAsset {
  id: string;
  title: string;
  file_path: string;
  format: string;
  duration_seconds: number | null;
  subtitle_paths: { lang: string; format: string; path: string }[];
  created_at: string;
}

interface PlaybackState {
  position_seconds: number;
  playback_speed: number;
  selected_quality: string | null;
}

@Component({
  selector: 'app-media-player',
  templateUrl: './media-player.component.html',
  styleUrls: ['./media-player.component.scss']
})
export class MediaPlayerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoPlayer', { static: false }) videoRef!: ElementRef<HTMLVideoElement>;

  assets: MediaAsset[] = [];
  selectedAsset: MediaAsset | null = null;
  isLoading = true;
  errorMessage = '';
  playerError = '';

  // Playback controls
  playbackSpeed = 1.0;
  speedOptions = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  qualityLevels: { index: number; label: string }[] = [];
  selectedQuality = -1;
  subtitlesEnabled = false;
  isPiPActive = false;

  // State
  currentTime = 0;
  duration = 0;
  isPlaying = false;
  isSavingPlayback = false;

  // Error retry state
  retryCount = 0;
  isRetrying = false;
  permanentError = false;
  lastErrorCode: VodErrorCode | string = '';

  private hlsInstance: HlsInstance | null = null;
  private dashPlayer: DashPlayer | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadAssets();
  }

  ngAfterViewInit(): void {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      if (params['id']) {
        this.loadAsset(params['id']);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.savePlaybackState();
    this.destroyPlayer();
  }

  loadAssets(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.api.get<PaginatedResponse<MediaAsset>>('/media', { page: 1, pageSize: 100 }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (res) => {
        this.assets = res.data || [];
        this.isLoading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load media assets.';
        this.isLoading = false;
      }
    });
  }

  loadAsset(assetId: string): void {
    this.api.get<MediaAsset>(`/media/${assetId}`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (asset) => {
        this.selectAsset(asset);
      },
      error: () => {
        this.playerError = 'Failed to load media asset.';
      }
    });
  }

  selectAsset(asset: MediaAsset): void {
    this.destroyPlayer();
    this.selectedAsset = asset;
    this.playerError = '';
    this.qualityLevels = [];
    this.selectedQuality = -1;
    this.resetRetryState();

    this.loadPlaybackState(asset.id);

    setTimeout(() => {
      this.initPlayer(asset);
    }, 100);
  }

  private initPlayer(asset: MediaAsset): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;

    video.playbackRate = this.playbackSpeed;

    if (asset.format === 'hls') {
      this.initHls(video, asset.file_path);
    } else if (asset.format === 'dash') {
      this.initDash(video, asset.file_path);
    } else {
      video.src = asset.file_path;
    }

    this.setupVideoEventListeners(video);
    this.setupSubtitles(video, asset);
    this.startPlaybackSaver();
  }

  private initHls(video: HTMLVideoElement, src: string): void {
    try {
      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        this.hlsInstance = new Hls();
        this.hlsInstance.loadSource(src);
        this.hlsInstance.attachMedia(video);

        this.hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          if (this.hlsInstance) {
            this.qualityLevels = this.hlsInstance.levels.map((level, i) => ({
              index: i,
              label: `${level.height}p`
            }));
            this.qualityLevels.unshift({ index: -1, label: 'Auto' });
          }
        });

        this.hlsInstance.on(Hls.Events.ERROR, (_event: unknown, data: Record<string, unknown>) => {
          if (data['fatal']) {
            const errorCode = this.classifyError(data);
            const contextMessage = `${data['type']} (${data['details']})`;
            this.handlePlayerError(errorCode, contextMessage);
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
      } else {
        this.playerError = 'HLS playback is not supported in this browser.';
      }
    } catch {
      this.playerError = 'Failed to initialize HLS player. Error code: HLS_INIT_FAILED';
    }
  }

  private initDash(video: HTMLVideoElement, src: string): void {
    try {
      if (typeof dashjs !== 'undefined') {
        this.dashPlayer = dashjs.MediaPlayer().create();
        this.dashPlayer.initialize(video, src, false);

        this.dashPlayer.on('streamInitialized', () => {
          if (this.dashPlayer) {
            const bitrateList = this.dashPlayer.getBitrateInfoListFor('video');
            this.qualityLevels = bitrateList.map(b => ({
              index: b.qualityIndex,
              label: `${b.height}p`
            }));
            this.qualityLevels.unshift({ index: -1, label: 'Auto' });
          }
        });

        this.dashPlayer.on('error', () => {
          this.handlePlayerError(VOD_ERROR_CODES.NETWORK_ERROR, 'DASH playback error');
        });
      } else {
        this.playerError = 'DASH.js player library not available. Error code: DASH_NOT_LOADED';
      }
    } catch {
      this.playerError = 'Failed to initialize DASH player. Error code: DASH_INIT_FAILED';
    }
  }

  private setupVideoEventListeners(video: HTMLVideoElement): void {
    video.onplay = () => { this.isPlaying = true; };
    video.onpause = () => { this.isPlaying = false; };
    video.ontimeupdate = () => {
      this.currentTime = video.currentTime;
      this.duration = video.duration || 0;
    };
    video.onerror = () => {
      const nativeCode = video.error?.code || 0;
      const errorMessages: Record<number, string> = {
        1: 'MEDIA_ERR_ABORTED: Playback aborted by user',
        2: 'MEDIA_ERR_NETWORK: Network error during download',
        3: 'MEDIA_ERR_DECODE: Error decoding media',
        4: 'MEDIA_ERR_SRC_NOT_SUPPORTED: Media format not supported'
      };
      const contextMessage = errorMessages[nativeCode] || `Unknown playback error (native code: ${nativeCode})`;

      if (nativeCode === 1) {
        // User-initiated abort -- do not retry
        this.playerError = `[${VOD_ERROR_CODES.MEDIA_NOT_FOUND}] ${contextMessage}`;
        return;
      }

      const vodCode = this.classifyNativeVideoError(nativeCode);
      this.handlePlayerError(vodCode, contextMessage);
    };
  }

  private setupSubtitles(video: HTMLVideoElement, asset: MediaAsset): void {
    if (asset.subtitle_paths && asset.subtitle_paths.length > 0) {
      asset.subtitle_paths.forEach(sub => {
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = sub.lang;
        track.srclang = sub.lang;
        track.src = sub.path;
        video.appendChild(track);
      });
    }
  }

  private destroyPlayer(): void {
    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }
    if (this.dashPlayer) {
      this.dashPlayer.destroy();
      this.dashPlayer = null;
    }
    if (this.videoRef?.nativeElement) {
      this.videoRef.nativeElement.pause();
      this.videoRef.nativeElement.removeAttribute('src');
      this.videoRef.nativeElement.load();
    }
  }

  private classifyError(data: Record<string, unknown>): VodErrorCode {
    const errorType = String(data['type'] || '');
    const errorDetails = String(data['details'] || '');

    if (errorType === 'networkError' || errorDetails.includes('frag') && errorDetails.includes('Load')) {
      return VOD_ERROR_CODES.NETWORK_ERROR;
    }
    if (errorDetails.includes('manifestParsing') || errorDetails.includes('levelLoad') || errorDetails.includes('manifestLoad')) {
      return VOD_ERROR_CODES.MANIFEST_PARSE_ERROR;
    }
    if (errorType === 'mediaError' || errorDetails.includes('bufferAppend') || errorDetails.includes('Decode')) {
      return VOD_ERROR_CODES.SEGMENT_DECODE_FAIL;
    }
    if (errorDetails.includes('notFound') || errorDetails.includes('404')) {
      return VOD_ERROR_CODES.MEDIA_NOT_FOUND;
    }
    return VOD_ERROR_CODES.NETWORK_ERROR;
  }

  private classifyNativeVideoError(code: number): VodErrorCode {
    switch (code) {
      case 2: return VOD_ERROR_CODES.NETWORK_ERROR;
      case 3: return VOD_ERROR_CODES.SEGMENT_DECODE_FAIL;
      case 4: return VOD_ERROR_CODES.MEDIA_NOT_FOUND;
      default: return VOD_ERROR_CODES.NETWORK_ERROR;
    }
  }

  private handlePlayerError(errorCode: VodErrorCode, contextMessage: string): void {
    this.lastErrorCode = errorCode;

    if (this.retryCount >= MAX_RETRIES) {
      this.permanentError = true;
      this.isRetrying = false;
      this.playerError = `Permanent playback failure [${errorCode}]: ${contextMessage}. All ${MAX_RETRIES} retry attempts exhausted.`;
      this.snackBar.open(
        `Playback failed after ${MAX_RETRIES} retries. Error: ${errorCode}`,
        'Close',
        { duration: 5000 }
      );
      return;
    }

    const delayMs = RETRY_DELAYS_MS[this.retryCount];
    this.retryCount++;
    this.isRetrying = true;
    this.playerError = `Playback error [${errorCode}]: ${contextMessage}. Retrying in ${delayMs / 1000}s (attempt ${this.retryCount}/${MAX_RETRIES})...`;

    timer(delayMs)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.isRetrying = false;
        this.retryPlayback();
      });
  }

  private retryPlayback(): void {
    if (!this.selectedAsset) {
      return;
    }

    this.playerError = '';
    this.destroyPlayer();

    const savedTime = this.currentTime;

    setTimeout(() => {
      if (!this.selectedAsset) return;

      const video = this.videoRef?.nativeElement;
      if (!video) return;

      video.playbackRate = this.playbackSpeed;

      if (this.selectedAsset.format === 'hls') {
        this.initHls(video, this.selectedAsset.file_path);
      } else if (this.selectedAsset.format === 'dash') {
        this.initDash(video, this.selectedAsset.file_path);
      } else {
        video.src = this.selectedAsset.file_path;
      }

      this.setupVideoEventListeners(video);
      this.setupSubtitles(video, this.selectedAsset);
      this.startPlaybackSaver();

      if (savedTime > 0) {
        setTimeout(() => {
          if (video) {
            video.currentTime = savedTime;
          }
        }, 500);
      }
    }, 100);
  }

  private resetRetryState(): void {
    this.retryCount = 0;
    this.isRetrying = false;
    this.permanentError = false;
    this.lastErrorCode = '';
  }

  // Controls
  togglePlay(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  setSpeed(speed: number): void {
    this.playbackSpeed = speed;
    if (this.videoRef?.nativeElement) {
      this.videoRef.nativeElement.playbackRate = speed;
    }
  }

  setQuality(qualityIndex: number): void {
    this.selectedQuality = qualityIndex;
    if (this.hlsInstance) {
      this.hlsInstance.currentLevel = qualityIndex;
    }
    if (this.dashPlayer) {
      if (qualityIndex === -1) {
        this.dashPlayer.setQualityFor('video', -1);
      } else {
        this.dashPlayer.setQualityFor('video', qualityIndex);
      }
    }
  }

  toggleSubtitles(): void {
    this.subtitlesEnabled = !this.subtitlesEnabled;
    const video = this.videoRef?.nativeElement;
    if (!video) return;

    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = this.subtitlesEnabled ? 'showing' : 'hidden';
    }
  }

  async togglePiP(): Promise<void> {
    const video = this.videoRef?.nativeElement;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        this.isPiPActive = false;
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
        this.isPiPActive = true;
      }
    } catch {
      this.snackBar.open('Picture-in-Picture not supported', 'Close', { duration: 2000 });
    }
  }

  seek(event: Event): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    const input = event.target as HTMLInputElement;
    video.currentTime = parseFloat(input.value);
  }

  // Playback state persistence
  loadPlaybackState(assetId: string): void {
    this.api.get<PlaybackState>(`/media/${assetId}/playback-state`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (state) => {
        if (state && state.position_seconds > 0) {
          this.playbackSpeed = state.playback_speed || 1.0;
          setTimeout(() => {
            const video = this.videoRef?.nativeElement;
            if (video) {
              video.currentTime = state.position_seconds;
              video.playbackRate = this.playbackSpeed;
            }
          }, 500);
        }
      },
      error: () => {
        // No saved state, start from beginning
      }
    });
  }

  private startPlaybackSaver(): void {
    interval(10000).pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.savePlaybackState();
    });
  }

  savePlaybackState(): void {
    if (!this.selectedAsset || !this.videoRef?.nativeElement) return;
    const video = this.videoRef.nativeElement;
    if (video.currentTime <= 0) return;

    this.api.put(`/media/${this.selectedAsset.id}/playback-state`, {
      position_seconds: Math.floor(video.currentTime),
      playback_speed: this.playbackSpeed,
      selected_quality: this.selectedQuality >= 0
        ? this.qualityLevels.find(q => q.index === this.selectedQuality)?.label || null
        : null
    }).subscribe();
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
