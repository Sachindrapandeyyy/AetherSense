//! Multi-frequency channel hopping TDM scheduler (ADR-029).

/// Channels used for multi-frequency mesh scanning.
pub const SCAN_CHANNELS: [u8; 3] = [1, 6, 11];

/// Configuration for the TDM scheduler.
#[derive(Debug, Clone)]
pub struct TdmConfig {
    /// Slot duration in milliseconds.
    pub slot_duration_ms: u64,
}

impl Default for TdmConfig {
    fn default() -> Self {
        Self {
            slot_duration_ms: 10,
        }
    }
}

/// TDM slot assignment containing the target node and channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlotAssignment {
    /// The node ID assigned to transmit/listen in this slot.
    pub node_id: u8,
    /// The channel (1, 6, or 11) to hop to.
    pub channel: u8,
}

/// Time Division Multiplexing (TDM) Scheduler for multi-frequency scanning.
pub struct TdmScheduler {
    config: TdmConfig,
    active_nodes: Vec<u8>,
}

impl TdmScheduler {
    /// Create a new TDM scheduler with the given configuration.
    pub fn new(config: TdmConfig) -> Self {
        Self {
            config,
            active_nodes: Vec::new(),
        }
    }

    /// Register a node in the TDM rotation.
    pub fn register_node(&mut self, node_id: u8) {
        if !self.active_nodes.contains(&node_id) {
            self.active_nodes.push(node_id);
            self.active_nodes.sort();
        }
    }

    /// De-register a node from the TDM rotation.
    pub fn deregister_node(&mut self, node_id: u8) {
        self.active_nodes.retain(|&id| id != node_id);
    }

    /// Calculate the channel slot assignment for a given timestamp (in milliseconds).
    pub fn get_assignment(&self, timestamp_ms: u64) -> Option<SlotAssignment> {
        if self.active_nodes.is_empty() {
            return None;
        }

        // Determine current slot index
        let slot_idx = (timestamp_ms / self.config.slot_duration_ms) as usize;

        // Select node for this slot (round-robin)
        let node_idx = slot_idx % self.active_nodes.len();
        let node_id = self.active_nodes[node_idx];

        // Select channel for this slot (channel hops every sweep)
        let sweep_idx = slot_idx / self.active_nodes.len();
        let channel_idx = (sweep_idx + node_idx) % SCAN_CHANNELS.len();
        let channel = SCAN_CHANNELS[channel_idx];

        Some(SlotAssignment { node_id, channel })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tdm_scheduler_rotation() {
        let mut scheduler = TdmScheduler::new(TdmConfig { slot_duration_ms: 10 });
        scheduler.register_node(1);
        scheduler.register_node(2);
        scheduler.register_node(3);

        // At t=0 (slot 0): node 1, channel index 0 (ch 1)
        let a1 = scheduler.get_assignment(0).unwrap();
        assert_eq!(a1.node_id, 1);
        assert_eq!(a1.channel, 1);

        // At t=10 (slot 1): node 2, channel index 1 (ch 6)
        let a2 = scheduler.get_assignment(10).unwrap();
        assert_eq!(a2.node_id, 2);
        assert_eq!(a2.channel, 6);

        // At t=30 (slot 3): first node of the next sweep (node 1) should hop to channel 6
        let a3 = scheduler.get_assignment(30).unwrap();
        assert_eq!(a3.node_id, 1);
        assert_eq!(a3.channel, 6);
    }
}
