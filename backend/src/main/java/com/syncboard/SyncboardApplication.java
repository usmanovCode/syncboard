package com.syncboard;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class SyncboardApplication {

    public static void main(String[] args) {
        SpringApplication.run(SyncboardApplication.class, args);
    }
}
