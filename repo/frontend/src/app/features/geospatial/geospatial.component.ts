import { Component, OnInit, OnDestroy, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';
import * as L from 'leaflet';

interface GeoDataset {
  id: string;
  name: string;
  source_type: string;
  import_status: string;
  feature_count: number | null;
  bounds: Record<string, unknown> | null;
  created_at: string;
}

interface GeoFeature {
  id: string;
  dataset_id: string;
  geometry: unknown;
  properties: Record<string, unknown>;
}

interface AnalysisResult {
  type: string;
  data: Record<string, unknown>;
}

@Component({
  selector: 'app-geospatial',
  templateUrl: './geospatial.component.html',
  styleUrls: ['./geospatial.component.scss']
})
export class GeospatialComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef;

  private map: L.Map | null = null;
  private featureLayers: Map<string, L.LayerGroup> = new Map();

  datasets: GeoDataset[] = [];
  visibleLayers: Set<string> = new Set();
  isLoading = true;
  errorMessage = '';

  // Import
  importForm!: FormGroup;
  showImportForm = false;
  isImporting = false;
  selectedFile: File | null = null;

  // Analysis
  analysisForm!: FormGroup;
  showAnalysis = false;
  analysisResult: AnalysisResult | null = null;
  isAnalyzing = false;
  analysisTypes = ['aggregation', 'density', 'buffer'];

  private destroy$ = new Subject<void>();

  constructor(
    private api: ApiService,
    private fb: FormBuilder,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.importForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(255)]],
      source_type: ['geojson', Validators.required]
    });

    this.analysisForm = this.fb.group({
      dataset_id: ['', Validators.required],
      analysis_type: ['aggregation', Validators.required],
      property: [''],
      gridSize: [100, Validators.min(1)],
      distance: [1000, Validators.min(1)],
      unit: ['meters']
    });

    this.loadDatasets();
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.disposeMap();
  }

  private initMap(): void {
    if (!this.mapContainer) return;

    this.map = L.map(this.mapContainer.nativeElement, {
      center: [39.8283, -98.5795],
      zoom: 4,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(this.map);
  }

  private disposeMap(): void {
    if (this.map) {
      this.featureLayers.forEach(layer => layer.remove());
      this.featureLayers.clear();
      this.map.remove();
      this.map = null;
    }
  }

  loadDatasets(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.api.get<GeoDataset[]>('/geo/datasets').pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (datasets) => {
        this.datasets = Array.isArray(datasets) ? datasets : [];
        this.isLoading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load geospatial datasets.';
        this.isLoading = false;
      }
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
      const fileName = this.selectedFile.name.toLowerCase();
      if (fileName.endsWith('.csv')) {
        this.importForm.patchValue({ source_type: 'csv' });
      } else if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
        this.importForm.patchValue({ source_type: 'geojson' });
      }
    }
  }

  importDataset(): void {
    if (this.importForm.invalid || !this.selectedFile) return;
    this.isImporting = true;

    const reader = new FileReader();
    reader.onload = () => {
      const fileContent = reader.result as string;
      const body = {
        name: this.importForm.value.name,
        source_type: this.importForm.value.source_type,
        file_content: fileContent
      };

      this.api.post<GeoDataset>('/geo/datasets', body).pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: (dataset) => {
          this.datasets = [dataset, ...this.datasets];
          this.isImporting = false;
          this.showImportForm = false;
          this.importForm.reset({ source_type: 'geojson' });
          this.selectedFile = null;
          this.snackBar.open('Dataset imported successfully', 'Close', { duration: 3000 });
        },
        error: () => {
          this.isImporting = false;
          this.snackBar.open('Failed to import dataset', 'Close', { duration: 3000 });
        }
      });
    };
    reader.readAsText(this.selectedFile);
  }

  toggleLayer(dataset: GeoDataset): void {
    if (this.visibleLayers.has(dataset.id)) {
      this.removeLayer(dataset.id);
    } else {
      this.addLayer(dataset);
    }
  }

  addLayer(dataset: GeoDataset): void {
    this.api.get<{ data: GeoFeature[] }>(`/geo/datasets/${dataset.id}/features`, {
      limit: 5000
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        if (!this.map) return;

        const layerGroup = L.layerGroup();
        const features = res.data || [];

        features.forEach(feature => {
          try {
            const geoJsonLayer = L.geoJSON(feature.geometry as L.GeoJSON);
            geoJsonLayer.addTo(layerGroup);
          } catch {
            // Skip invalid geometry
          }
        });

        layerGroup.addTo(this.map);
        this.featureLayers.set(dataset.id, layerGroup);
        this.visibleLayers.add(dataset.id);

        if (features.length > 0 && dataset.bounds) {
          try {
            const bounds = dataset.bounds as Record<string, number>;
            if (bounds['minLat'] && bounds['maxLat'] && bounds['minLng'] && bounds['maxLng']) {
              this.map.fitBounds([
                [bounds['minLat'], bounds['minLng']],
                [bounds['maxLat'], bounds['maxLng']]
              ]);
            }
          } catch {
            // Ignore bounds fitting errors
          }
        }
      },
      error: () => {
        this.snackBar.open('Failed to load layer features', 'Close', { duration: 3000 });
      }
    });
  }

  removeLayer(datasetId: string): void {
    const layer = this.featureLayers.get(datasetId);
    if (layer) {
      layer.remove();
      this.featureLayers.delete(datasetId);
    }
    this.visibleLayers.delete(datasetId);
  }

  runAnalysis(): void {
    if (this.analysisForm.invalid) return;
    this.isAnalyzing = true;

    const formValue = this.analysisForm.value;
    const datasetId = formValue.dataset_id;
    let endpoint = '';
    let params: Record<string, string | number> = {};

    switch (formValue.analysis_type) {
      case 'aggregation':
        endpoint = `/geo/datasets/${datasetId}/aggregate`;
        params = { property: formValue.property || 'count' };
        break;
      case 'density':
        endpoint = `/geo/datasets/${datasetId}/density`;
        params = { gridSize: formValue.gridSize };
        break;
      case 'buffer':
        endpoint = `/geo/datasets/${datasetId}/buffer`;
        params = { distance: formValue.distance, unit: formValue.unit };
        break;
    }

    this.api.get<Record<string, unknown>>(endpoint, params).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (data) => {
        this.analysisResult = { type: formValue.analysis_type, data };
        this.isAnalyzing = false;
      },
      error: () => {
        this.isAnalyzing = false;
        this.snackBar.open('Analysis failed', 'Close', { duration: 3000 });
      }
    });
  }

  isLayerVisible(datasetId: string): boolean {
    return this.visibleLayers.has(datasetId);
  }

  getImportStatusIcon(status: string): string {
    const icons: Record<string, string> = {
      pending: 'schedule',
      processing: 'sync',
      complete: 'check_circle',
      error: 'error'
    };
    return icons[status] || 'info';
  }
}
