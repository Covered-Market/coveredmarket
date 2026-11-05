# One VM on DigitalOcean + DNS for the domain + a firewall. Nothing else.
# `bin/covered provision` = terraform init && terraform apply. Secrets come from terraform.tfvars (gitignored).
terraform {
  required_version = ">= 1.6"
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.40"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

variable "do_token" {
  type      = string
  sensitive = true
}

variable "domain" {
  type        = string
  description = "e.g. covered.money; its nameservers must point at DigitalOcean (ns1/ns2/ns3.digitalocean.com)"
}

variable "region" {
  type    = string
  default = "ams3"
}

variable "size" {
  type    = string
  default = "s-1vcpu-2gb"
}

variable "ssh_key_name" {
  type        = string
  description = "name of an SSH key already uploaded to DigitalOcean (your laptop)"
}

variable "repo" {
  type    = string
  default = "https://github.com/COVERED_ORG/covered.git"
}

variable "git_ref" {
  type    = string
  default = "main"
}

variable "env_file" {
  type        = string
  sensitive   = true
  description = "contents of the production .env (see .env.example)"
}

variable "deploy_pubkey" {
  type        = string
  description = "public key GitHub Actions (and you) use to ssh in as `deploy`"
}

data "digitalocean_ssh_key" "me" {
  name = var.ssh_key_name
}

resource "digitalocean_droplet" "vm" {
  name     = "covered"
  region   = var.region
  size     = var.size
  image    = "ubuntu-24-04-x64"
  ssh_keys = [data.digitalocean_ssh_key.me.id]
  tags     = ["covered"]
  user_data = templatefile("${path.module}/cloud-init.yaml", {
    repo          = var.repo
    git_ref       = var.git_ref
    env_file      = var.env_file
    domain        = var.domain
    deploy_pubkey = var.deploy_pubkey
  })
}

resource "digitalocean_domain" "root" {
  name = var.domain
}

resource "digitalocean_record" "a" {
  domain = digitalocean_domain.root.id
  type   = "A"
  name   = "@"
  value  = digitalocean_droplet.vm.ipv4_address
  ttl    = 300
}

resource "digitalocean_record" "www" {
  domain = digitalocean_domain.root.id
  type   = "CNAME"
  name   = "www"
  value  = "${var.domain}."
  ttl    = 300
}

resource "digitalocean_firewall" "fw" {
  name        = "covered"
  droplet_ids = [digitalocean_droplet.vm.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

output "ip" {
  value = digitalocean_droplet.vm.ipv4_address
}

output "url" {
  value = "https://${var.domain}"
}

output "ssh" {
  value = "ssh deploy@${digitalocean_droplet.vm.ipv4_address}"
}
