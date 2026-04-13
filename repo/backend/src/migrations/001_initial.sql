-- TalentOps Compliance & Service Desk - Initial Schema
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ============================================================
-- Core Identity & Auth
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','recruiter','reviewer','approver')),
  locale VARCHAR(10) DEFAULT 'en',
  force_password_change BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- Recruiting Domain
-- ============================================================
CREATE TABLE recruiting_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','archived')),
  created_by UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rp_status ON recruiting_projects(status);
CREATE INDEX idx_rp_created_by ON recruiting_projects(created_by);

CREATE TABLE job_postings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES recruiting_projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  requirements JSONB,
  field_rules JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_jp_project ON job_postings(project_id);
CREATE INDEX idx_jp_status ON job_postings(status);

CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_posting_id UUID REFERENCES job_postings(id),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  ssn_encrypted BYTEA,
  dob_encrypted BYTEA,
  compensation_encrypted BYTEA,
  eeoc_disposition VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'intake' CHECK (status IN ('intake','screening','review','approved','rejected')),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_cand_posting ON candidates(job_posting_id);
CREATE INDEX idx_cand_status ON candidates(status);

CREATE TABLE resume_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content JSONB NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (candidate_id, version_number)
);
CREATE INDEX idx_rv_candidate ON resume_versions(candidate_id);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size <= 10485760),
  file_type VARCHAR(10) NOT NULL CHECK (file_type IN ('pdf','docx')),
  page_count INTEGER,
  quality_status VARCHAR(20) DEFAULT 'pending' CHECK (quality_status IN ('pending','passed','failed')),
  quality_errors JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_att_candidate ON attachments(candidate_id);

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) UNIQUE NOT NULL,
  color VARCHAR(7)
);
CREATE INDEX idx_tag_name ON tags(name);

CREATE TABLE candidate_tags (
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (candidate_id, tag_id)
);

-- ============================================================
-- Violation & Compliance
-- ============================================================
CREATE TABLE violation_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_type VARCHAR(30) NOT NULL CHECK (rule_type IN ('prohibited_phrase','missing_field','duplicate_pattern','custom')),
  rule_config JSONB NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('warning','error','critical')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE violation_instances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID REFERENCES candidates(id),
  rule_id UUID REFERENCES violation_rules(id),
  details JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed','escalated')),
  reviewed_by UUID REFERENCES users(id),
  decision VARCHAR(50),
  review_comment TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_vi_status ON violation_instances(status);
CREATE INDEX idx_vi_candidate ON violation_instances(candidate_id);

CREATE TABLE audit_trail (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(100) NOT NULL,
  actor_id UUID REFERENCES users(id),
  before_state JSONB,
  after_state JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_entity ON audit_trail(entity_type, entity_id);
CREATE INDEX idx_audit_actor ON audit_trail(actor_id);
CREATE INDEX idx_audit_created ON audit_trail(created_at);

-- ============================================================
-- Service Catalog
-- ============================================================
CREATE TABLE service_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES service_categories(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sc_parent ON service_categories(parent_id);

CREATE TABLE service_attributes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  data_type VARCHAR(50) NOT NULL,
  is_required BOOLEAN DEFAULT false
);

CREATE TABLE service_specifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID REFERENCES service_categories(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes % 15 = 0),
  headcount INTEGER NOT NULL CHECK (headcount BETWEEN 1 AND 20),
  tools_addons JSONB DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','retired')),
  daily_capacity INTEGER,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ss_status ON service_specifications(status);
CREATE INDEX idx_ss_category ON service_specifications(category_id);

CREATE TABLE service_tags (
  spec_id UUID NOT NULL REFERENCES service_specifications(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (spec_id, tag_id)
);

CREATE TABLE pricing_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  spec_id UUID NOT NULL REFERENCES service_specifications(id) ON DELETE CASCADE,
  rule_type VARCHAR(20) NOT NULL CHECK (rule_type IN ('base','tiered','surcharge')),
  base_price DECIMAL(10,2),
  tier_config JSONB,
  surcharge_label VARCHAR(255),
  surcharge_amount DECIMAL(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pr_spec ON pricing_rules(spec_id);

CREATE TABLE capacity_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  spec_id UUID REFERENCES service_specifications(id),
  date DATE NOT NULL,
  max_volume INTEGER NOT NULL,
  current_volume INTEGER DEFAULT 0,
  is_stopped BOOLEAN DEFAULT false,
  UNIQUE (spec_id, date)
);
CREATE INDEX idx_cp_date ON capacity_plans(date);

-- ============================================================
-- Credit Change
-- ============================================================
CREATE TABLE credit_changes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reason TEXT NOT NULL,
  requested_by UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_cc_entity ON credit_changes(entity_type, entity_id);
CREATE INDEX idx_cc_status ON credit_changes(status);

-- ============================================================
-- Approval Workflow
-- ============================================================
CREATE TABLE approval_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  approval_mode VARCHAR(10) NOT NULL CHECK (approval_mode IN ('joint','any')),
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approval_template_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES approval_templates(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  approver_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, step_order)
);
CREATE INDEX idx_ats_template ON approval_template_steps(template_id);

CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID REFERENCES approval_templates(id),
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  requested_by UUID REFERENCES users(id),
  approval_mode VARCHAR(10) NOT NULL CHECK (approval_mode IN ('joint','any')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  final_write_back JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ar_status ON approval_requests(status);
CREATE INDEX idx_ar_entity ON approval_requests(entity_type, entity_id);

CREATE TABLE approval_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  approver_id UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  comment TEXT,
  attachment_path VARCHAR(500),
  attachment_size INTEGER,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_as_request ON approval_steps(request_id);
CREATE INDEX idx_as_approver ON approval_steps(approver_id);
CREATE INDEX idx_as_status ON approval_steps(status);

-- ============================================================
-- Notifications
-- ============================================================
CREATE TABLE notification_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_key VARCHAR(100) UNIQUE NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('in_app','email_export','sms_export')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ntpl_key ON notification_templates(template_key);

CREATE TABLE notification_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID REFERENCES users(id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('in_app','email_export','sms_export')),
  template_key VARCHAR(100) NOT NULL,
  template_vars JSONB NOT NULL DEFAULT '{}',
  rendered_content TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','generated','opened','acknowledged','failed')),
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  export_path VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_nt_recipient ON notification_tasks(recipient_id);
CREATE INDEX idx_nt_status ON notification_tasks(status);

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  author_id UUID REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_comment_entity ON comments(entity_type, entity_id);

-- ============================================================
-- Geospatial
-- ============================================================
CREATE TABLE geo_datasets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('csv','geojson','gps')),
  file_path VARCHAR(500) NOT NULL,
  import_status VARCHAR(20) DEFAULT 'pending' CHECK (import_status IN ('pending','processing','complete','error')),
  feature_count INTEGER,
  bounds JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_gd_status ON geo_datasets(import_status);

CREATE TABLE geo_features (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dataset_id UUID NOT NULL REFERENCES geo_datasets(id) ON DELETE CASCADE,
  geometry GEOMETRY(Geometry, 4326),
  properties JSONB
);
CREATE INDEX idx_gf_dataset ON geo_features(dataset_id);
CREATE INDEX idx_gf_geom ON geo_features USING GIST (geometry);

-- ============================================================
-- Crash Recovery & Checkpoints
-- ============================================================
CREATE TABLE app_checkpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  checkpoint_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ckpt_user ON app_checkpoints(user_id);

-- ============================================================
-- Media / VOD
-- ============================================================
CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  format VARCHAR(10) NOT NULL CHECK (format IN ('hls','dash')),
  duration_seconds DECIMAL(10,2),
  subtitle_paths JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE playback_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  asset_id UUID NOT NULL REFERENCES media_assets(id),
  position_seconds DECIMAL(10,2) NOT NULL DEFAULT 0,
  playback_speed DECIMAL(3,1) DEFAULT 1.0,
  selected_quality VARCHAR(50),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, asset_id)
);
