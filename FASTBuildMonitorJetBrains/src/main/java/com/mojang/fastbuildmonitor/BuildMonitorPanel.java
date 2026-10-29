// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.mojang.fastbuildmonitor;

import com.intellij.ide.CopyProvider;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.actionSystem.DataContext;
import com.intellij.openapi.actionSystem.DataProvider;
import com.intellij.openapi.actionSystem.PlatformDataKeys;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.ui.popup.JBPopupFactory;
import com.intellij.openapi.util.text.StringUtil;
import com.intellij.ui.JBColor;
import com.intellij.ui.ColorUtil;
import com.intellij.ui.OnePixelSplitter;
import com.intellij.ui.ToolbarDecorator;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBTextArea;
import com.intellij.util.ui.JBUI;

import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JPanel;
import javax.swing.JProgressBar;
import javax.swing.JTable;
import javax.swing.JScrollPane;
import javax.swing.JViewport;
import javax.swing.ListSelectionModel;
import javax.swing.RowSorter;
import javax.swing.SortOrder;
import javax.swing.table.DefaultTableCellRenderer;
import javax.swing.table.TableRowSorter;
import javax.swing.UIManager;
import javax.swing.table.AbstractTableModel;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Cursor;
import java.awt.Dimension;
import java.awt.Graphics;
import java.awt.Point;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.Rectangle;
import java.awt.datatransfer.StringSelection;
import java.awt.event.MouseEvent;
import java.awt.event.MouseAdapter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.StringJoiner;
import java.util.function.Consumer;

final class BuildMonitorPanel extends JPanel implements Disposable, DataProvider, CopyProvider {
    private final BuildMonitorService service;
    private final WorkerNames workerNames = new WorkerNames(this::refreshWorkerNames);
    private final JobTableModel tableModel = new JobTableModel(workerNames);
    private final JTable jobsTable = new JTable(tableModel);
    private final JBLabel statusLabel = new JBLabel();
    private final JBLabel statsLabel = new JBLabel("No FASTBuild session detected");
    private final ReadableProgressBar progressBar = new ReadableProgressBar();
    private final TimelinePanel timeline = new TimelinePanel(workerNames);
    private final Consumer<BuildSnapshot> listener = this::showSnapshot;
    private final MonitoringButton monitoringButton;

    BuildMonitorPanel(BuildMonitorService service) {
        super(new BorderLayout(JBUI.scale(8), JBUI.scale(8)));
        this.service = service;
        monitoringButton = new MonitoringButton(service::start, service::stop);
        setBorder(JBUI.Borders.empty(8));

        jobsTable.setSelectionMode(ListSelectionModel.MULTIPLE_INTERVAL_SELECTION);
        TableRowSorter<JobTableModel> sorter = new TableRowSorter<>(tableModel);
        sorter.setSortsOnUpdates(true);
        sorter.setSortKeys(List.of(new RowSorter.SortKey(2, SortOrder.ASCENDING)));
        jobsTable.setRowSorter(sorter);
        jobsTable.setDefaultRenderer(Long.class, new DefaultTableCellRenderer() {
            @Override
            protected void setValue(Object value) {
                setText(value instanceof Long duration ? JobTableModel.formatDuration(duration) : "");
            }
        });
        jobsTable.getColumnModel().getColumn(2).setCellRenderer(new DefaultTableCellRenderer() {
            private Color statusColor;

            @Override
            protected void setValue(Object value) {
                super.setValue(value);
                statusColor = ((BuildJob.Status) value).getColor();
                setBorder(JBUI.Borders.empty(1, 2, 1, 20));
            }

            @Override
            protected void paintComponent(Graphics graphics) {
                super.paintComponent(graphics);
                Graphics2D g = (Graphics2D) graphics.create();
                try {
                    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                    int diameter = JBUI.scale(8);
                    g.setColor(statusColor);
                    g.fillOval(getWidth() - diameter - JBUI.scale(6), (getHeight() - diameter) / 2,
                            diameter, diameter);
                } finally {
                    g.dispose();
                }
            }
        });
        jobsTable.setFillsViewportHeight(true);
        jobsTable.setPreferredScrollableViewportSize(new Dimension(360, 300));
        JPanel tablePanel = ToolbarDecorator.createDecorator(jobsTable).disableAddAction()
                .disableRemoveAction().createPanel();

        progressBar.setString("Waiting for build");
        progressBar.setPreferredSize(new Dimension(100, JBUI.scale(22)));
        progressBar.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent event) {
                String errors = errorLog(service.getSnapshot().session());
                if (!errors.isEmpty()) {
                    JBTextArea text = new JBTextArea(errors);
                    text.setEditable(false);
                    text.setCaretPosition(0);
                    JScrollPane scroll = new JScrollPane(text);
                    scroll.setPreferredSize(new Dimension(JBUI.scale(700), JBUI.scale(400)));
                    JBPopupFactory.getInstance().createComponentPopupBuilder(scroll, text)
                            .setTitle("FASTBuild error log").setResizable(true).setMovable(true)
                            .setRequestFocus(true).createPopup().showUnderneathOf(progressBar);
                }
            }
        });

        JPanel header = new JPanel(new BorderLayout(0, JBUI.scale(5)));
        JPanel summary = new JPanel(new BorderLayout(JBUI.scale(8), 0));
        summary.add(progressBar, BorderLayout.WEST);
        summary.add(statsLabel, BorderLayout.CENTER);
        summary.add(monitoringButton, BorderLayout.EAST);
        header.add(summary, BorderLayout.CENTER);
        header.add(statusLabel, BorderLayout.SOUTH);
        add(header, BorderLayout.NORTH);

        JScrollPane timelineScroll = new JScrollPane(timeline);
        timelineScroll.setBorder(JBUI.Borders.empty());
        timelineScroll.getVerticalScrollBar().setUnitIncrement(JBUI.scale(24));
        timelineScroll.getHorizontalScrollBar().setUnitIncrement(JBUI.scale(40));
        followHorizontalEnd(timelineScroll.getViewport());
        OnePixelSplitter split = new OnePixelSplitter(true, 2f / 3f);
        split.setFirstComponent(timelineScroll);
        split.setSecondComponent(tablePanel);
        add(split, BorderLayout.CENTER);
        service.addListener(listener);
    }

    @Override
    public void dispose() {
        service.removeListener(listener);
        workerNames.dispose();
    }

    @Override
    public Object getData(String dataId) {
        return PlatformDataKeys.COPY_PROVIDER.is(dataId) ? this : null;
    }

    @Override
    public boolean isCopyEnabled(DataContext context) {
        return jobsTable.isFocusOwner() && jobsTable.getSelectedRowCount() > 0;
    }

    @Override
    public boolean isCopyVisible(DataContext context) {
        return true;
    }

    @Override
    public void performCopy(DataContext context) {
        StringJoiner rows = new StringJoiner("\n");
        for (int row : jobsTable.getSelectedRows()) {
            StringJoiner columns = new StringJoiner("\t");
            for (int column = 0; column < jobsTable.getColumnCount(); column++) {
                Object value = jobsTable.getValueAt(row, column);
                columns.add(value instanceof Long duration ? JobTableModel.formatDuration(duration) : value.toString());
            }
            rows.add(columns.toString());
        }
        CopyPasteManager.getInstance().setContents(new StringSelection(rows.toString()));
    }

    private void refreshWorkerNames() {
        showSnapshot(service.getSnapshot());
    }

    private static void followHorizontalEnd(JViewport viewport) {
        boolean[] following = {true};
        int[] layout = {-1, -1};
        viewport.addChangeListener(event -> {
            Component view = viewport.getView();
            if (view == null) {
                return;
            }
            int viewWidth = view.getWidth();
            int extentWidth = viewport.getExtentSize().width;
            Point position = viewport.getViewPosition();
            int end = Math.max(0, viewWidth - extentWidth);
            if (layout[0] == viewWidth && layout[1] == extentWidth) {
                following[0] = position.x >= end - JBUI.scale(4);
                return;
            }
            layout[0] = viewWidth;
            layout[1] = extentWidth;
            following[0] |= position.x >= end;
            if (following[0] && position.x != end) {
                viewport.setViewPosition(new Point(end, position.y));
            }
        });
    }

    private void showSnapshot(BuildSnapshot snapshot) {
        monitoringButton.setMonitoring(snapshot.monitoring());
        statusLabel.setText(snapshot.message());
        statusLabel.setVisible(showStatusMessage(snapshot.message()));
        BuildSession session = snapshot.session();
        String errors = errorLog(session);
        progressBar.failed = !errors.isEmpty();
        progressBar.setCursor(Cursor.getPredefinedCursor(
                errors.isEmpty() ? Cursor.DEFAULT_CURSOR : Cursor.HAND_CURSOR));
        progressBar.setToolTipText(errors.isEmpty() ? null
                : "<html>" + StringUtil.escapeXmlEntities(errors).replace("\n", "<br>")
                + "<br>Click to open error log</html>");
        if (session == null) {
            statsLabel.setText("No FASTBuild session detected");
            progressBar.setValue(0);
            progressBar.setString(snapshot.monitoring() ? "Waiting for build" : "");
            tableModel.setSession(null);
            timeline.setSession(null);
            timeline.setToolTipText(null);
            return;
        }

        int total = session.jobs().size();
        int active = 0;
        int succeeded = 0;
        int cached = 0;
        int failed = 0;
        for (BuildJob job : session.jobs()) {
            switch (job.status()) {
                case BUILDING -> active++;
                case SUCCESS -> succeeded++;
                case SUCCESS_CACHED -> {
                    succeeded++;
                    cached++;
                }
                case SUCCESS_PREPROCESSED -> succeeded++;
                case FAILED, ERROR, TIMEOUT -> failed++;
                default -> {
                }
            }
        }
        progressBar.setValue((int) Math.max(0, Math.min(100, Math.round(session.progress()))));
        progressBar.setString(progressText(session, System.currentTimeMillis()));
        progressBar.setPreferredSize(new Dimension(Math.max(JBUI.scale(100),
                progressBar.getFontMetrics(progressBar.getFont()).stringWidth(progressBar.getString())
                        + JBUI.scale(16)), JBUI.scale(22)));
        progressBar.revalidate();
        statsLabel.setText(String.format(
                "Jobs: %d   Active: %d   Succeeded: %d   Cached: %d   Failed: %d   Workers: %d",
                total, active, succeeded, cached, failed, snapshot.workers().size()));
        tableModel.setSession(session);
        timeline.setSession(session);
        timeline.setToolTipText(workerSummary(snapshot.workers()));
    }

    static boolean showStatusMessage(String message) {
        return !message.startsWith("Monitoring ");
    }

    static String progressText(BuildSession session, long now) {
        if (session.jobs().stream().anyMatch(BuildJob::failed)) {
            return "error";
        }
        long end = session.endTime() == 0 ? now : session.endTime();
        return session.progress() >= 100
                ? String.format("100%% (%.1fs)", Math.max(0, end - session.startTime()) / 1000.0)
                : String.format("%.1f%%", session.progress());
    }

    static String errorLog(BuildSession session) {
        StringJoiner errors = new StringJoiner("\n\n");
        if (session != null) {
            for (BuildJob job : session.jobs()) {
                if (job.failed()) {
                    errors.add(job.eventName() + " (" + job.hostName() + "): " + job.status()
                            + "\n" + (job.message() == null || job.message().isBlank()
                            ? "No diagnostic output was recorded in the FASTBuild monitor log."
                            : job.message()));
                }
            }
        }
        return errors.toString();
    }

    private String workerSummary(Map<String, BuildSnapshot.WorkerSnapshot> workers) {
        if (workers.isEmpty()) {
            return null;
        }
        StringBuilder text = new StringBuilder("<html>");
        for (BuildSnapshot.WorkerSnapshot worker : workers.values()) {
            text.append(StringUtil.escapeXmlEntities(workerNames.displayName(worker.hostName()))).append(": ")
                    .append(worker.activeJobs()).append(" active / ")
                    .append(worker.totalJobs()).append(" jobs<br>");
        }
        return text.append("</html>").toString();
    }

    private static final class JobTableModel extends AbstractTableModel {
        private static final String[] COLUMNS = {"Job", "Worker", "Status", "Duration"};
        private final WorkerNames workerNames;
        private BuildSession session;
        private List<BuildJob> jobs = List.of();

        JobTableModel(WorkerNames workerNames) {
            this.workerNames = workerNames;
        }

        void setSession(BuildSession session) {
            int previousSize = jobs.size();
            boolean sameBuild = this.session != null && session != null
                    && this.session.startTime() == session.startTime()
                    && this.session.processId() == session.processId();
            this.session = session;
            List<BuildJob> nextJobs = session == null ? List.of() : session.jobs();
            if (!sameBuild || nextJobs.size() < previousSize) {
                jobs = nextJobs;
                fireTableDataChanged();
            } else {
                jobs = nextJobs.subList(0, previousSize);
                if (previousSize > 0) {
                    fireTableRowsUpdated(0, previousSize - 1);
                }
                jobs = nextJobs;
                if (jobs.size() > previousSize) {
                    fireTableRowsInserted(previousSize, jobs.size() - 1);
                }
            }
        }

        @Override
        public int getRowCount() {
            return jobs.size();
        }

        @Override
        public int getColumnCount() {
            return COLUMNS.length;
        }

        @Override
        public Class<?> getColumnClass(int columnIndex) {
            return switch (columnIndex) {
                case 2 -> BuildJob.Status.class;
                case 3 -> Long.class;
                default -> String.class;
            };
        }

        @Override
        public String getColumnName(int column) {
            return COLUMNS[column];
        }

        @Override
        public Object getValueAt(int rowIndex, int columnIndex) {
            BuildJob job = jobs.get(rowIndex);
            return switch (columnIndex) {
                case 0 -> job.getDisplayName();
                case 1 -> workerNames.displayName(job.hostName());
                case 2 -> job.status();
                case 3 -> job.durationAt(System.currentTimeMillis());
                default -> "";
            };
        }

        private static String formatDuration(long milliseconds) {
            long minutes = milliseconds / 60_000;
            double seconds = (milliseconds / 1000.0) % 60.0;
            return minutes > 0 ? String.format("%d:%04.1f", minutes, seconds)
                    : String.format("%.1fs", milliseconds / 1000.0);
        }
    }

    static final class ReadableProgressBar extends JProgressBar {
        private boolean failed;

        ReadableProgressBar() {
            super(0, 100);
            setStringPainted(true);
        }

        static Color contrastingText(Color background) {
            double luminance = 0.2126 * linear(background.getRed())
                    + 0.7152 * linear(background.getGreen()) + 0.0722 * linear(background.getBlue());
            return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
                    ? Color.BLACK : Color.WHITE;
        }

        private static double linear(int channel) {
            double value = channel / 255.0;
            return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
        }

        @Override
        protected void paintComponent(Graphics graphics) {
            Graphics2D g = (Graphics2D) graphics.create();
            try {
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                Color track = JBColor.namedColor("ProgressBar.background",
                        new JBColor(0xDFE1E5, 0x43454A));
                Color fill = failed ? JBColor.namedColor("ProgressBar.failedColor",
                        new JBColor(0xDB3B4B, 0xDB5C5C)) : JBColor.namedColor("ProgressBar.progressColor",
                        new JBColor(0x3574F0, 0x3574F0));
                int width = getWidth();
                int height = getHeight();
                int filled = failed ? width : (int) Math.round(width * getPercentComplete());
                g.clip(new java.awt.geom.RoundRectangle2D.Double(0, 0, width, height, height, height));
                g.setColor(track);
                g.fillRect(0, 0, width, height);
                g.setColor(fill);
                g.fillRect(0, 0, filled, height);
                String text = getString();
                java.awt.FontMetrics metrics = g.getFontMetrics();
                int x = (width - metrics.stringWidth(text)) / 2;
                int y = (height - metrics.getHeight()) / 2 + metrics.getAscent();
                java.awt.Shape clip = g.getClip();
                g.clipRect(0, 0, filled, height);
                g.setColor(contrastingText(fill));
                g.drawString(text, x, y);
                g.setClip(clip);
                g.clipRect(filled, 0, width - filled, height);
                g.setColor(contrastingText(track));
                g.drawString(text, x, y);
            } finally {
                g.dispose();
            }
        }
    }

    static final class MonitoringButton extends JButton {
        private boolean monitoring;

        MonitoringButton(Runnable start, Runnable stop) {
            addActionListener(event -> {
                if (monitoring) {
                    stop.run();
                } else {
                    start.run();
                }
            });
            setMonitoring(false);
        }

        void setMonitoring(boolean monitoring) {
            this.monitoring = monitoring;
            setText(monitoring ? "Stop Monitoring" : "Start Monitoring");
            setToolTipText(monitoring ? "Stop monitoring the FASTBuild log" : "Start monitoring the FASTBuild log");
            repaint();
        }

        @Override
        public boolean isDefaultButton() {
            return !monitoring;
        }
    }

    static final class TimelinePanel extends JComponent {
        private record Segment(Rectangle bounds, BuildJob job) {}

        private final WorkerNames workerNames;
        private final List<Segment> segments = new ArrayList<>();
        private int labelWidth;
        private BuildSession session;

        TimelinePanel(WorkerNames workerNames) {
            this.workerNames = workerNames;
            setPreferredSize(new Dimension(600, 220));
            setMinimumSize(new Dimension(200, 100));
        }

        void setSession(BuildSession session) {
            this.session = session;
            segments.clear();
            repaint();
        }

        @Override
        public String getToolTipText(MouseEvent event) {
            Rectangle visible = getVisibleRect();
            if (event.getX() < visible.x + labelWidth || event.getY() < visible.y + JBUI.scale(32)) {
                return super.getToolTipText(event);
            }
            for (int index = segments.size() - 1; index >= 0; index--) {
                Segment segment = segments.get(index);
                if (segment.bounds().contains(event.getPoint())) {
                    BuildJob job = segment.job();
                    return "<html>" + StringUtil.escapeXmlEntities(job.eventName())
                            + "<br>Worker: " + StringUtil.escapeXmlEntities(workerNames.displayName(job.hostName()))
                            + "<br>Status: " + job.status()
                            + "<br>Duration: " + JobTableModel.formatDuration(job.durationAt(System.currentTimeMillis()))
                            + (job.message() == null || job.message().isBlank() ? ""
                            : "<br>" + StringUtil.escapeXmlEntities(job.message()).replace("\n", "<br>"))
                            + "</html>";
                }
            }
            return super.getToolTipText(event);
        }

        @Override
        protected void paintComponent(Graphics graphics) {
            super.paintComponent(graphics);
            segments.clear();
            Graphics2D g = (Graphics2D) graphics.create();
            try {
                g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                Color background = UIManager.getColor("Table.background");
                Color foreground = UIManager.getColor("Table.foreground");
                background = background == null ? JBColor.background() : background;
                foreground = foreground == null ? JBColor.foreground() : foreground;
                Color alternate = UIManager.getColor("Table.alternateRowColor");
                if (alternate == null || alternate.equals(background)) {
                    alternate = ColorUtil.mix(background, foreground, 0.05);
                }
                g.setColor(background);
                g.fillRect(0, 0, getWidth(), getHeight());
                if (session == null || session.jobs().isEmpty()) {
                    if (!getPreferredSize().equals(new Dimension(600, JBUI.scale(220)))) {
                        setPreferredSize(new Dimension(600, JBUI.scale(220)));
                        revalidate();
                    }
                    g.setColor(foreground);
                    g.drawString("No jobs (Waiting for build)", JBUI.scale(12), JBUI.scale(24));
                    return;
                }
                List<TimelineLayout.CoreRow> rows = TimelineLayout.rows(session, System.currentTimeMillis());
                long start = session.startTime();
                long end = session.endTime() == 0 ? System.currentTimeMillis() : session.endTime();
                end = Math.max(start + 1, end);
                for (TimelineLayout.CoreRow row : rows) {
                    for (BuildJob job : row.jobs()) {
                        end = Math.max(end, job.endTime());
                    }
                }
                labelWidth = Math.max(JBUI.scale(180), rows.stream()
                        .mapToInt(row -> g.getFontMetrics().stringWidth(rowLabel(row)))
                        .max().orElse(0) + JBUI.scale(16));
                int rowHeight = JBUI.scale(28);
                int top = JBUI.scale(32);
                int pixelsPerSecond = JBUI.scale(20);
                int contentWidth = labelWidth + (int) Math.min(Integer.MAX_VALUE - labelWidth - JBUI.scale(40),
                        Math.ceil((end - start) / 1000.0 * pixelsPerSecond)) + JBUI.scale(40);
                int contentHeight = top + rows.size() * rowHeight + JBUI.scale(8);
                Dimension contentSize = new Dimension(Math.max(600, contentWidth), contentHeight);
                if (!getPreferredSize().equals(contentSize)) {
                    setPreferredSize(contentSize);
                    revalidate();
                }
                Rectangle visible = getVisibleRect();
                for (int index = 0; index < rows.size(); index++) {
                    TimelineLayout.CoreRow row = rows.get(index);
                    int y = top + index * rowHeight;
                    g.setColor(index % 2 == 0 ? background : alternate);
                    g.fillRect(0, y, getWidth(), rowHeight);
                    java.awt.Shape clip = g.getClip();
                    g.clipRect(visible.x + labelWidth, y, Math.max(0, visible.width - labelWidth), rowHeight);
                    for (BuildJob job : row.jobs()) {
                        long jobEnd = job.endTime() == 0 ? System.currentTimeMillis() : job.endTime();
                        int x = labelWidth + (int) ((job.startTime() - start) / 1000.0 * pixelsPerSecond);
                        int width = Math.max(JBUI.scale(3),
                                (int) ((jobEnd - job.startTime()) / 1000.0 * pixelsPerSecond));
                        int barY = y + JBUI.scale(4);
                        int barHeight = rowHeight - JBUI.scale(8);
                        int barWidth = Math.max(0, Math.min(width, getWidth() - x - 2));
                        g.setColor(job.status().getColor());
                        g.fillRoundRect(x, barY, barWidth, barHeight,
                                JBUI.scale(4), JBUI.scale(4));
                        segments.add(new Segment(new Rectangle(x, barY, barWidth, barHeight), job));
                    }
                    g.setClip(clip);
                    g.setColor(index % 2 == 0 ? background : alternate);
                    g.fillRect(visible.x, y, labelWidth, rowHeight);
                    g.setColor(foreground);
                    g.drawString(rowLabel(row), visible.x + JBUI.scale(8),
                            y + rowHeight - JBUI.scale(7));
                }
                g.setColor(background);
                g.fillRect(visible.x, visible.y, visible.width, top);
                g.setColor(foreground);
                int tickWidth = pixelsPerSecond * 5;
                int firstTick = Math.max(0, visible.x / tickWidth);
                for (int tick = firstTick; labelWidth + tick * (long) tickWidth < visible.x + visible.width; tick++) {
                    int x = labelWidth + tick * tickWidth;
                    if (x < visible.x + labelWidth) {
                        continue;
                    }
                    g.drawString(String.format("%d:%02d", tick * 5 / 60, tick * 5 % 60),
                            x, visible.y + JBUI.scale(18));
                    g.drawLine(x, visible.y + top - JBUI.scale(6), x, visible.y + top);
                }
            } finally {
                g.dispose();
            }
        }

        private String rowLabel(TimelineLayout.CoreRow row) {
            return workerNames.computerName(row.hostName()) + " / Core " + (row.coreIndex() + 1);
        }
    }
}
