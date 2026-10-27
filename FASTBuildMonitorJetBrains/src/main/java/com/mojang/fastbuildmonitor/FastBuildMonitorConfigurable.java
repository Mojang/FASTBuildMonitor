// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.mojang.fastbuildmonitor;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory;
import com.intellij.openapi.options.Configurable;
import com.intellij.openapi.project.ProjectManager;
import com.intellij.openapi.ui.TextFieldWithBrowseButton;
import com.intellij.ui.components.JBCheckBox;
import com.intellij.ui.components.JBTextField;
import com.intellij.util.ui.FormBuilder;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.Nullable;

import javax.swing.JComponent;
import javax.swing.JPanel;
import javax.swing.JSpinner;
import javax.swing.SpinnerNumberModel;

public final class FastBuildMonitorConfigurable implements Configurable {
    private TextFieldWithBrowseButton logPathField;
    private JSpinner pollIntervalField;
    private JBCheckBox autoStartField;

    @Override
    public @Nls String getDisplayName() {
        return "FASTBuild Monitor";
    }

    @Override
    public @Nullable JComponent createComponent() {
        JBTextField path = new JBTextField(30);
        path.getEmptyText().setText(BuildMonitorService.detectedLogPath());
        path.setToolTipText("Leave empty to use the auto-detected log path");
        logPathField = new TextFieldWithBrowseButton(path);
        logPathField.addBrowseFolderListener(
                "Select FASTBuild log file",
                "Choose FastBuildLog.log. Leave empty to use the FASTBuild default location.",
                null,
                FileChooserDescriptorFactory.createSingleFileDescriptor()
        );
        pollIntervalField = new JSpinner(new SpinnerNumberModel(
                FastBuildMonitorSettings.DEFAULT_POLL_INTERVAL_MS, 100, 5000, 100));
        autoStartField = new JBCheckBox("Start monitoring when the tool window opens");

        JPanel panel = FormBuilder.createFormBuilder()
                .addLabeledComponent("FASTBuild log file:", logPathField)
                .addLabeledComponent("Polling interval (ms):", pollIntervalField)
                .addComponent(autoStartField)
                .addComponentFillVertically(new JPanel(), 0)
                .getPanel();
        reset();
        return panel;
    }

    @Override
    public boolean isModified() {
        FastBuildMonitorSettings settings = settings();
        return !logPathField.getText().trim().equals(settings.getLogPath())
                || ((Number) pollIntervalField.getValue()).intValue() != settings.getPollIntervalMs()
                || autoStartField.isSelected() != settings.isAutoStart();
    }

    @Override
    public void apply() {
        FastBuildMonitorSettings settings = settings();
        settings.setLogPath(logPathField.getText());
        settings.setPollIntervalMs(((Number) pollIntervalField.getValue()).intValue());
        settings.setAutoStart(autoStartField.isSelected());
        for (var project : ProjectManager.getInstance().getOpenProjects()) {
            BuildMonitorService service = project.getServiceIfCreated(BuildMonitorService.class);
            if (service != null) {
                service.settingsChanged();
            }
        }
    }

    @Override
    public void reset() {
        FastBuildMonitorSettings settings = settings();
        logPathField.setText(settings.getLogPath());
        pollIntervalField.setValue(settings.getPollIntervalMs());
        autoStartField.setSelected(settings.isAutoStart());
    }

    @Override
    public void disposeUIResources() {
        logPathField = null;
        pollIntervalField = null;
        autoStartField = null;
    }

    private static FastBuildMonitorSettings settings() {
        return ApplicationManager.getApplication().getService(FastBuildMonitorSettings.class);
    }
}
